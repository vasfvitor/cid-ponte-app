import { TokenCache, handle, type Env } from "./proxy";

let cache: TokenCache | undefined;

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    cache ??= new TokenCache(env);
    return handle(req, env, cache);
  },
};
