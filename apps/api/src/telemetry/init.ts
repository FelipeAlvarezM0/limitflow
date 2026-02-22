import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import type { AppConfig } from "@quotaguard/shared";

export type TelemetryShutdown = () => Promise<void>;

export async function initTelemetry(config: AppConfig): Promise<TelemetryShutdown> {
  if (config.NODE_ENV === "development") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
  }

  const traceExporter = config.OTEL_EXPORTER_OTLP_ENDPOINT
    ? new OTLPTraceExporter({
        url: config.OTEL_EXPORTER_OTLP_ENDPOINT
      })
    : undefined;

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: config.OTEL_SERVICE_NAME
    }),
    traceExporter,
    instrumentations: [getNodeAutoInstrumentations()]
  });

  await sdk.start();

  return async () => {
    await sdk.shutdown();
  };
}
