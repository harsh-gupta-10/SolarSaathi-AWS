import type { APIGatewayProxyEvent } from "aws-lambda";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { documentExecutor } from "../data/client";
import { CoreRepository } from "../data/repository";
import { CoreService, type ServiceDependencies } from "../data/service";
import { DesignsService } from "../designs/service";
import { NovaCanvasImageGenerator, S3DesignAssetStore, type DesignAssetStore, type DesignImageGenerator } from "../designs/image";
import { DesignStore } from "../designs/store";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";

type Route = "RECOMMEND" | "GENERATE" | "TEMPLATES" | "IMAGE";
function route(event: APIGatewayProxyEvent): Route {
  const stage = event.requestContext?.stage;
  const relative = stage && event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
  const path = relative.startsWith("/v1/") ? relative : `/v1${relative}`;
  const resource = event.resource.startsWith("/v1/") ? event.resource : `/v1${event.resource}`;
  const kind: Route | undefined = resource === "/v1/designs/recommend" || path === "/v1/designs/recommend" ? "RECOMMEND" :
    resource === "/v1/designs/generate" || path === "/v1/designs/generate" ? "GENERATE" :
      resource === "/v1/designs/templates" || path === "/v1/designs/templates" ? "TEMPLATES" :
        resource === "/v1/designs/{designId}/image" || /^\/v1\/designs\/[A-Za-z0-9_-]+\/image$/.test(path) ? "IMAGE" : undefined;
  if (!kind) throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
  const method = kind === "RECOMMEND" || kind === "GENERATE" ? "POST" : "GET";
  if (event.httpMethod !== method) throw new RequestError(405, "METHOD_NOT_ALLOWED", `Use ${method} for this endpoint.`);
  return kind;
}

export interface DesignsHandlerDependencies extends ServiceDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  createRepository?: (tableName: string, region: string) => CoreRepository;
  createDesignStore?: (tableName: string, region: string) => DesignStore;
  createAssets?: (bucket: string, region: string) => DesignAssetStore;
  createImageGenerator?: (modelId: string, region: string) => DesignImageGenerator;
}

export function createDesignsHandler(dependencies: DesignsHandlerDependencies = {}) {
  const resolveIdentity = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  const createRepository = dependencies.createRepository ?? ((tableName: string, region: string) =>
    new CoreRepository(tableName, documentExecutor(region)));
  const createDesignStore = dependencies.createDesignStore ?? ((tableName: string, region: string) =>
    new DesignStore(tableName, documentExecutor(region)));
  const createAssets = dependencies.createAssets ?? ((bucket: string, region: string) => new S3DesignAssetStore(bucket, region));
  const createImageGenerator = dependencies.createImageGenerator ?? ((modelId: string, region: string) =>
    new NovaCanvasImageGenerator(modelId, region));
  const assetCache = new Map<string, DesignAssetStore>();
  const generatorCache = new Map<string, DesignImageGenerator>();
  return withRequestLogging(async (event, context, environment) => {
    const kind = route(event);
    if (!environment.CORE_TABLE_NAME) throw new RequestError(503, "DATABASE_NOT_CONFIGURED", "The core database is not configured.");
    const body = kind === "RECOMMEND" || kind === "GENERATE" ? parseJsonObject(event) : undefined;
    const identity = currentIdentityResponse(await resolveIdentity(event, environment), context.awsRequestId);
    const core = new CoreService(createRepository(environment.CORE_TABLE_NAME, environment.AWS_REGION), dependencies);
    const store = createDesignStore(environment.CORE_TABLE_NAME, environment.AWS_REGION);
    const bucket = environment.DESIGN_ASSET_BUCKET;
    let assets: DesignAssetStore | undefined;
    if (bucket) {
      assets = assetCache.get(bucket);
      if (!assets) { assets = createAssets(bucket, environment.AWS_REGION); assetCache.set(bucket, assets); }
    }
    const modelId = environment.DESIGN_IMAGE_MODEL_ID;
    let generator: DesignImageGenerator | undefined;
    if (modelId) {
      const region = environment.DESIGN_IMAGE_REGION ?? environment.AWS_REGION;
      const key = `${region}:${modelId}`;
      generator = generatorCache.get(key);
      if (!generator) { generator = createImageGenerator(modelId, region); generatorCache.set(key, generator); }
    }
    const service = new DesignsService(core, store, generator, assets, dependencies);
    if (kind === "RECOMMEND") return jsonResponse(200, await service.recommend(identity, body, context.awsRequestId));
    if (kind === "GENERATE") return jsonResponse(200, await service.generate(identity, body, context.awsRequestId));
    if (kind === "TEMPLATES") return jsonResponse(200, await service.template(identity,
      event.queryStringParameters?.fingerprint, context.awsRequestId));
    return jsonResponse(200, await service.image(identity, event.pathParameters?.designId,
      event.queryStringParameters, context.awsRequestId));
  });
}

export const handler = createDesignsHandler();
