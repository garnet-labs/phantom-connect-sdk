import { getTool, getToolNames, tools } from "./index";

describe("tools registry", () => {
  it("contains unique tool names", () => {
    const names = getToolNames();
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it("getTool returns handlers for known tools", () => {
    const firstToolName = tools[0].name;
    expect(getTool(firstToolName)).toBeDefined();
    expect(getTool(firstToolName)?.name).toBe(firstToolName);
  });

  it("getTool returns undefined for unknown names", () => {
    expect(getTool("not_a_real_tool")).toBeUndefined();
  });
});
