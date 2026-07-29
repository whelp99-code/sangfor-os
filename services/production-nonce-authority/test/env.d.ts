declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {
    readonly __productionNonceAuthorityTestEnv?: never;
  }
}
