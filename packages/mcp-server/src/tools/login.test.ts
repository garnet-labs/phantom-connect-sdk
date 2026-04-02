import { loginTool } from "./login";

describe("phantom_login tool placeholder", () => {
  it("throws because phantom_login must be handled in server.ts", () => {
    expect(() => loginTool.handler({} as any, {} as any)).toThrow(
      "phantom_login must be handled by the server before normal tool dispatch.",
    );
  });
});
