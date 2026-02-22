import type { Redis } from "ioredis";

const fixedWindowLua = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])

local current = redis.call("INCRBY", key, cost)
if current == cost then
  redis.call("EXPIRE", key, window)
end

local ttl = redis.call("TTL", key)
if ttl < 0 then
  ttl = window
end

local allowed = 0
if current <= limit then
  allowed = 1
end

local remaining = limit - current
if remaining < 0 then
  remaining = 0
end

local retry_after = 0
if allowed == 0 then
  retry_after = ttl
end

return { allowed, limit, remaining, ttl, retry_after }
`;

const tokenBucketLua = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now_ms = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])

local state = redis.call("HMGET", key, "tokens", "last_refill_ms")
local tokens = tonumber(state[1])
local last_refill = tonumber(state[2])

if tokens == nil then
  tokens = capacity
  last_refill = now_ms
end

if last_refill > now_ms then
  last_refill = now_ms
end

local elapsed = now_ms - last_refill
if elapsed > 0 then
  tokens = math.min(capacity, tokens + (elapsed * refill_per_ms))
  last_refill = now_ms
end

local allowed = 0
local retry_after = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  local missing = cost - tokens
  if refill_per_ms > 0 then
    retry_after = math.ceil((missing / refill_per_ms) / 1000)
  else
    retry_after = 1
  end
  if retry_after < 1 then
    retry_after = 1
  end
end

redis.call("HMSET", key, "tokens", tokens, "last_refill_ms", last_refill)
redis.call("EXPIRE", key, ttl)

local remaining = math.floor(tokens)
if remaining < 0 then
  remaining = 0
end

local reset_seconds = 1
if refill_per_ms > 0 then
  reset_seconds = math.ceil(((capacity - tokens) / refill_per_ms) / 1000)
  if reset_seconds < 1 then
    reset_seconds = 1
  end
end

return { allowed, capacity, remaining, reset_seconds, retry_after }
`;

const slidingWindowLua = `
local zkey = KEYS[1]
local seqkey = KEYS[2]

local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local request_id = ARGV[5]

local window_start = now_ms - window_ms
redis.call("ZREMRANGEBYSCORE", zkey, 0, window_start)

local current = redis.call("ZCARD", zkey)
local allowed = 0
local retry_after = 0

if (current + cost) <= limit then
  allowed = 1
  for i = 1, cost do
    local seq = redis.call("INCR", seqkey)
    local member = request_id .. ":" .. tostring(i) .. ":" .. tostring(seq)
    redis.call("ZADD", zkey, now_ms, member)
  end
  current = current + cost
  redis.call("PEXPIRE", zkey, window_ms)
  redis.call("PEXPIRE", seqkey, window_ms)
else
  local oldest = redis.call("ZRANGE", zkey, 0, 0, "WITHSCORES")
  if oldest[2] ~= nil then
    local oldest_score = tonumber(oldest[2])
    retry_after = math.ceil((oldest_score + window_ms - now_ms) / 1000)
    if retry_after < 1 then
      retry_after = 1
    end
  else
    retry_after = 1
  end
end

local remaining = limit - current
if remaining < 0 then
  remaining = 0
end

local oldest_after = redis.call("ZRANGE", zkey, 0, 0, "WITHSCORES")
local reset_seconds = math.ceil(window_ms / 1000)
if oldest_after[2] ~= nil then
  local score = tonumber(oldest_after[2])
  reset_seconds = math.ceil((score + window_ms - now_ms) / 1000)
  if reset_seconds < 1 then
    reset_seconds = 1
  end
end

return { allowed, limit, remaining, reset_seconds, retry_after }
`;

type ScriptName = "fixed_window" | "token_bucket" | "sliding_window";

const scriptMap: Record<ScriptName, string> = {
  fixed_window: fixedWindowLua,
  token_bucket: tokenBucketLua,
  sliding_window: slidingWindowLua
};

export class RedisScriptManager {
  private readonly shas = new Map<ScriptName, string>();

  constructor(private readonly redis: Redis) {}

  async loadScripts(): Promise<void> {
    for (const [name, script] of Object.entries(scriptMap) as Array<[ScriptName, string]>) {
      const sha = (await this.redis.script("LOAD", script)) as string;
      this.shas.set(name, sha);
    }
  }

  async evalScript(name: ScriptName, keys: string[], args: Array<string | number>): Promise<number[]> {
    const sha = this.shas.get(name);
    const normalizedArgs = args.map((value) => String(value));

    if (!sha) {
      await this.loadScripts();
      return this.evalScript(name, keys, normalizedArgs);
    }

    try {
      const result = (await this.redis.evalsha(sha, keys.length, ...keys, ...normalizedArgs)) as number[];
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("NOSCRIPT")) {
        await this.loadScripts();
        return this.evalScript(name, keys, normalizedArgs);
      }
      throw error;
    }
  }
}


