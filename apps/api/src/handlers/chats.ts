import type { APIGatewayProxyEvent } from "aws-lambda";
import type { ChatConfirmResponse, ChatDetailResponse, ChatListResponse } from "@solarsaathi/types";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { identifier, parseInput } from "../data/schemas";
import { confirmProposal } from "../chat/confirm";
import { chatConfirmRequestSchema, chatListQuerySchema } from "../chat/schema";
import { createChatRuntime, type ChatRuntime, type ChatServiceDependencies } from "../chat/services";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";

type Route = { kind: "list" } | { kind: "detail" | "delete"; chatId: string } | { kind: "deleteAll" } | { kind: "confirm" };

function route(event: APIGatewayProxyEvent): Route {
  const stage = event.requestContext?.stage;
  const relative = stage && event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
  const path = (relative.startsWith("/v1/") ? relative : `/v1${relative}`).replace(/\/$/, "");
  const method = event.httpMethod;
  if (path === "/v1/chats") {
    if (method === "GET") return { kind: "list" };
    if (method === "DELETE") return { kind: "deleteAll" };
    throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use GET or DELETE for this endpoint.");
  }
  if (path === "/v1/chat/confirm") {
    if (method !== "POST") throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
    return { kind: "confirm" };
  }
  const match = path.match(/^\/v1\/chats\/([^/]+)$/);
  if (match) {
    const chatId = parseInput(identifier, decodeURIComponent(match[1]!));
    if (method === "GET") return { kind: "detail", chatId };
    if (method === "DELETE") return { kind: "delete", chatId };
    throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use GET or DELETE for this endpoint.");
  }
  throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
}

export interface ChatsHandlerDependencies extends ChatServiceDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  runtime?: ChatRuntime;
}

export function createChatsHandler(dependencies: ChatsHandlerDependencies = {}) {
  const resolveIdentity = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  return withRequestLogging(async (event, context, environment) => {
    const selected = route(event);
    const identity = currentIdentityResponse(await resolveIdentity(event, environment), context.awsRequestId);
    const userId = identity.profile.userId;
    const runtime = dependencies.runtime ?? createChatRuntime(environment, dependencies);
    if (selected.kind === "list") {
      const query = parseInput(chatListQuerySchema, { ...(event.queryStringParameters ?? {}) });
      const page = await runtime.store.listChats(userId, query);
      const body: ChatListResponse = { chats: page.chats, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
      return jsonResponse(200, body);
    }
    if (selected.kind === "detail") {
      const chat = await runtime.store.getChat(userId, selected.chatId);
      if (!chat) throw new RequestError(404, "CHAT_NOT_FOUND", "The conversation was not found.");
      const { messages } = await runtime.store.listMessages(userId, selected.chatId);
      const body: ChatDetailResponse = { chat, messages };
      return jsonResponse(200, body);
    }
    if (selected.kind === "delete") { await runtime.store.deleteChat(userId, selected.chatId); return jsonResponse(200, { deleted: true }); }
    if (selected.kind === "deleteAll") return jsonResponse(200, await runtime.store.deleteAll(userId));
    const body = parseInput(chatConfirmRequestSchema, parseJsonObject(event, 1_024));
    const response: ChatConfirmResponse = await confirmProposal(runtime.services, identity, context.awsRequestId, body.proposalId);
    return jsonResponse(200, response);
  });
}

export const handler = createChatsHandler();
