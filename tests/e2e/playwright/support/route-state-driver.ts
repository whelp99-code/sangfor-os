import type { Page, Route } from "@playwright/test";

export class RouteStateDriver {
  private used = false;

  constructor(private readonly page: Page, private readonly targetPath: string) {
    if (!targetPath.startsWith("/")) throw new Error("ROUTE_STATE_TARGET_MUST_BE_SAME_ORIGIN");
  }

  private matches(route: Route): boolean {
    const request = route.request();
    const target = new URL(request.url());
    const current = new URL(this.page.url());
    return target.origin === current.origin
      && target.pathname === this.targetPath
      && request.headers().rsc === "1";
  }

  async holdNextRsc(): Promise<{ release: () => void; completed: Promise<void> }> {
    if (this.used) throw new Error("ROUTE_STATE_DRIVER_REUSED");
    this.used = true;
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let complete!: () => void;
    const completed = new Promise<void>((resolve) => { complete = resolve; });
    await this.page.route("**/*", async (route) => {
      if (!this.matches(route)) return route.continue();
      await released;
      await route.continue();
      complete();
      await this.page.unroute("**/*");
    });
    return { release, completed };
  }

  async failNextRsc(): Promise<void> {
    if (this.used) throw new Error("ROUTE_STATE_DRIVER_REUSED");
    this.used = true;
    await this.page.route("**/*", async (route) => {
      if (!this.matches(route)) return route.continue();
      await route.fulfill({
        status: 500,
        contentType: "text/plain; charset=utf-8",
        body: "UX_FIXTURE_ROUTE_ERROR",
      });
      await this.page.unroute("**/*");
    });
  }
}
