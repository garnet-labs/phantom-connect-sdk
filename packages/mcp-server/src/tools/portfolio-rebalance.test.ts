import {
  parseCaip19,
  buildAllocations,
  computeSwapPlan,
  portfolioRebalanceTool,
  type TokenAllocation,
  type TargetAllocationInput,
} from "./portfolio-rebalance";
import type { PortfolioItem } from "../utils/portfolio";

// --- Mock dependencies ---

jest.mock("@solana/web3.js", () => ({
  PublicKey: jest.fn().mockImplementation((key: string) => ({ toBase58: () => key })),
}));

jest.mock("bs58", () => ({
  default: { decode: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3])) },
}));

jest.mock("@phantom/base64url", () => ({
  base64urlEncode: jest.fn().mockReturnValue("base64url-encoded-tx"),
}));

// mockFetch is still used for EVM RPC calls (nonce, gas) in evm.ts
const mockFetch = jest.fn();
global.fetch = mockFetch;

const makeContext = () => {
  const apiClient = {
    get: jest.fn(),
    post: jest.fn(),
    setPaymentSignature: jest.fn(),
  };
  return {
    client: {
      signAndSendTransaction: jest.fn().mockResolvedValue({ hash: "0xtxhash", rawTransaction: "0xraw" }),
      getWalletAddresses: jest
        .fn()
        .mockResolvedValue([{ addressType: "solana", address: "So11111111111111111111111111111111111111112" }]),
    },
    session: { walletId: "wallet-1", organizationId: "org-1", appId: "test-app-id" },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    apiClient,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================
// parseCaip19
// ============================================================

describe("parseCaip19", () => {
  it("detects native SOL via slip44", () => {
    expect(parseCaip19("solana:101/slip44:501")).toEqual({ isNative: true, mint: null });
  });

  it("detects native SOL via nativeToken", () => {
    expect(parseCaip19("solana:101/nativeToken:501")).toEqual({ isNative: true, mint: null });
  });

  it("detects SPL token via /token:", () => {
    expect(parseCaip19("solana:101/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toEqual({
      isNative: false,
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
  });

  it("detects token via /address:", () => {
    expect(parseCaip19("solana:101/address:SomeMintAddr")).toEqual({
      isNative: false,
      mint: "SomeMintAddr",
    });
  });

  it("returns isNative false and null mint for unrecognized format", () => {
    expect(parseCaip19("solana:101/unknown:xyz")).toEqual({ isNative: false, mint: null });
  });
});

// ============================================================
// buildAllocations
// ============================================================

function makePortfolioItem(overrides: Partial<PortfolioItem> = {}): PortfolioItem {
  return {
    name: "Wrapped SOL",
    symbol: "SOL",
    decimals: 9,
    caip19: "solana:101/nativeToken:501",
    totalQuantity: 2_000_000_000, // 2 SOL in base units
    totalQuantityString: "2000000000",
    spamStatus: "VERIFIED",
    price: { price: 150, priceChange24h: 2.5 },
    queriedWalletBalances: [],
    ...overrides,
  };
}

describe("buildAllocations", () => {
  it("builds allocations from portfolio items with correct USD values", () => {
    const items: PortfolioItem[] = [
      makePortfolioItem({
        symbol: "SOL",
        caip19: "solana:101/nativeToken:501",
        totalQuantity: 2_000_000_000,
        totalQuantityString: "2000000000",
        decimals: 9,
        price: { price: 150, priceChange24h: 0 },
      }),
      makePortfolioItem({
        symbol: "USDC",
        caip19: "solana:101/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        totalQuantity: 100_000_000,
        totalQuantityString: "100000000",
        decimals: 6,
        price: { price: 1, priceChange24h: 0 },
      }),
    ];

    const allocations = buildAllocations(items);

    // SOL: 2_000_000_000 / 10^9 = 2 SOL * $150 = $300
    // USDC: 100_000_000 / 10^6 = 100 USDC * $1 = $100
    // Total = $400
    expect(allocations).toHaveLength(2);
    expect(allocations[0].symbol).toBe("SOL");
    expect(allocations[0].usdValue).toBeCloseTo(300, 2);
    expect(allocations[0].currentPercent).toBeCloseTo(75, 2);
    expect(allocations[0].isNative).toBe(true);
    expect(allocations[0].mint).toBeNull();

    expect(allocations[1].symbol).toBe("USDC");
    expect(allocations[1].usdValue).toBeCloseTo(100, 2);
    expect(allocations[1].currentPercent).toBeCloseTo(25, 2);
    expect(allocations[1].isNative).toBe(false);
    expect(allocations[1].mint).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });

  it("filters out non-VERIFIED (spam) tokens", () => {
    const items: PortfolioItem[] = [
      makePortfolioItem({ spamStatus: "VERIFIED" }),
      makePortfolioItem({ symbol: "SPAM", spamStatus: "SPAM" }),
    ];
    expect(buildAllocations(items)).toHaveLength(1);
    expect(buildAllocations(items)[0].symbol).toBe("SOL");
  });

  it("filters out tokens without prices", () => {
    const items: PortfolioItem[] = [makePortfolioItem(), makePortfolioItem({ symbol: "NOPR", price: undefined })];
    expect(buildAllocations(items)).toHaveLength(1);
  });

  it("filters out tokens with zero quantity", () => {
    const items: PortfolioItem[] = [makePortfolioItem(), makePortfolioItem({ symbol: "ZERO", totalQuantity: 0 })];
    expect(buildAllocations(items)).toHaveLength(1);
  });

  it("sorts by USD value descending", () => {
    const items: PortfolioItem[] = [
      makePortfolioItem({
        symbol: "SMALL",
        caip19: "solana:101/token:SMALL",
        totalQuantity: 1_000_000,
        totalQuantityString: "1000000",
        decimals: 6,
        price: { price: 1, priceChange24h: 0 },
      }),
      makePortfolioItem({
        symbol: "BIG",
        caip19: "solana:101/token:BIG",
        totalQuantity: 1_000_000_000,
        totalQuantityString: "1000000000",
        decimals: 6,
        price: { price: 100, priceChange24h: 0 },
      }),
    ];
    const allocations = buildAllocations(items);
    expect(allocations[0].symbol).toBe("BIG");
    expect(allocations[1].symbol).toBe("SMALL");
  });

  it("returns empty array for empty input", () => {
    expect(buildAllocations([])).toEqual([]);
  });

  it("handles single token at 100%", () => {
    const allocations = buildAllocations([makePortfolioItem()]);
    expect(allocations).toHaveLength(1);
    expect(allocations[0].currentPercent).toBeCloseTo(100, 2);
  });
});

// ============================================================
// computeSwapPlan
// ============================================================

function makeAllocation(overrides: Partial<TokenAllocation> = {}): TokenAllocation {
  return {
    symbol: "SOL",
    name: "Wrapped SOL",
    caip19: "solana:101/nativeToken:501",
    balance: 2,
    balanceBaseUnits: "2000000000",
    decimals: 9,
    priceUsd: 150,
    usdValue: 300,
    currentPercent: 75,
    isNative: true,
    mint: null,
    ...overrides,
  };
}

describe("computeSwapPlan", () => {
  describe("basic two-token rebalance", () => {
    // Portfolio: SOL $300 (75%), USDC $100 (25%), total $400
    // Target: 50/50 → SOL should sell $100 worth, USDC should buy $100 worth
    const tokens: TokenAllocation[] = [
      makeAllocation({
        symbol: "SOL",
        caip19: "solana:101/nativeToken:501",
        usdValue: 300,
        priceUsd: 150,
        decimals: 9,
        isNative: true,
        mint: null,
      }),
      makeAllocation({
        symbol: "USDC",
        caip19: "solana:101/token:USDC_MINT",
        usdValue: 100,
        priceUsd: 1,
        decimals: 6,
        isNative: false,
        mint: "USDC_MINT",
      }),
    ];

    it("produces one swap for two-token rebalance", () => {
      const targets: TargetAllocationInput[] = [
        { caip19: "solana:101/nativeToken:501", targetPercent: 50 },
        { caip19: "solana:101/token:USDC_MINT", targetPercent: 50 },
      ];
      const plan = computeSwapPlan(tokens, targets, 1.0);

      expect(plan).toHaveLength(1);
      expect(plan[0].sellSymbol).toBe("SOL");
      expect(plan[0].buySymbol).toBe("USDC");
      // SOL needs to sell ~$100 worth (minus fee reserve)
      // Fee reserve: 0.05 SOL * $150 = $7.50
      // maxSellUsd = $300 - $7.50 - $200 = $92.50
      expect(plan[0].sellAmountUsd).toBeCloseTo(92.5, 0);
    });
  });

  describe("three-token rebalance", () => {
    // Portfolio: SOL $500 (50%), USDC $300 (30%), BONK $200 (20%), total $1000
    // Target: SOL 30%, USDC 40%, BONK 30%
    const tokens: TokenAllocation[] = [
      makeAllocation({
        symbol: "SOL",
        caip19: "solana:101/nativeToken:501",
        usdValue: 500,
        priceUsd: 100,
        decimals: 9,
        isNative: true,
      }),
      makeAllocation({
        symbol: "USDC",
        caip19: "solana:101/token:USDC",
        usdValue: 300,
        priceUsd: 1,
        decimals: 6,
        isNative: false,
        mint: "USDC",
      }),
      makeAllocation({
        symbol: "BONK",
        caip19: "solana:101/token:BONK",
        usdValue: 200,
        priceUsd: 0.00001,
        decimals: 5,
        isNative: false,
        mint: "BONK",
      }),
    ];

    it("produces multiple swaps from one seller to two buyers", () => {
      const targets: TargetAllocationInput[] = [
        { caip19: "solana:101/nativeToken:501", targetPercent: 30 },
        { caip19: "solana:101/token:USDC", targetPercent: 40 },
        { caip19: "solana:101/token:BONK", targetPercent: 30 },
      ];

      const plan = computeSwapPlan(tokens, targets, 1.0);

      // SOL: current $500, target $300, delta = -$200 (seller)
      // SOL fee reserve: 0.05 * $100 = $5, maxSellUsd = $500 - $5 - $300 = $195
      // USDC: current $300, target $400, delta = +$100 (buyer)
      // BONK: current $200, target $300, delta = +$100 (buyer)
      // Greedy: SOL sells $100 → USDC, then SOL sells $95 → BONK
      expect(plan.length).toBeGreaterThanOrEqual(2);
      expect(plan[0].sellSymbol).toBe("SOL");

      const totalSellUsd = plan.reduce((s, p) => s + p.sellAmountUsd, 0);
      expect(totalSellUsd).toBeCloseTo(195, 0);
    });
  });

  describe("already balanced portfolio", () => {
    it("returns empty plan when current matches target", () => {
      const tokens: TokenAllocation[] = [
        makeAllocation({ caip19: "solana:101/nativeToken:501", usdValue: 500, priceUsd: 100 }),
        makeAllocation({ caip19: "solana:101/token:USDC", usdValue: 500, priceUsd: 1, isNative: false, mint: "USDC" }),
      ];
      const targets: TargetAllocationInput[] = [
        { caip19: "solana:101/nativeToken:501", targetPercent: 50 },
        { caip19: "solana:101/token:USDC", targetPercent: 50 },
      ];
      const plan = computeSwapPlan(tokens, targets, 1.0);
      expect(plan).toHaveLength(0);
    });
  });

  describe("minTradeUsd threshold", () => {
    it("skips swaps below minTradeUsd", () => {
      const tokens: TokenAllocation[] = [
        makeAllocation({
          caip19: "solana:101/token:A",
          usdValue: 50.5,
          priceUsd: 1,
          isNative: false,
          mint: "A",
          decimals: 6,
        }),
        makeAllocation({
          caip19: "solana:101/token:B",
          usdValue: 49.5,
          priceUsd: 1,
          isNative: false,
          mint: "B",
          decimals: 6,
        }),
      ];
      const targets: TargetAllocationInput[] = [
        { caip19: "solana:101/token:A", targetPercent: 50 },
        { caip19: "solana:101/token:B", targetPercent: 50 },
      ];
      // Deltas are $0.50 each, below minTradeUsd of 1
      const plan = computeSwapPlan(tokens, targets, 1.0);
      expect(plan).toHaveLength(0);
    });

    it("includes swaps above minTradeUsd", () => {
      const tokens: TokenAllocation[] = [
        makeAllocation({
          caip19: "solana:101/token:A",
          usdValue: 60,
          priceUsd: 1,
          isNative: false,
          mint: "A",
          decimals: 6,
        }),
        makeAllocation({
          caip19: "solana:101/token:B",
          usdValue: 40,
          priceUsd: 1,
          isNative: false,
          mint: "B",
          decimals: 6,
        }),
      ];
      const targets: TargetAllocationInput[] = [
        { caip19: "solana:101/token:A", targetPercent: 50 },
        { caip19: "solana:101/token:B", targetPercent: 50 },
      ];
      const plan = computeSwapPlan(tokens, targets, 1.0);
      expect(plan).toHaveLength(1);
      expect(plan[0].sellAmountUsd).toBeCloseTo(10, 0);
    });
  });

  describe("SOL fee reserve", () => {
    it("reserves 0.05 SOL worth of fees when selling SOL", () => {
      // Portfolio: SOL $200 (100%), target: SOL 10%, USDC 90%
      // But USDC isn't in current portfolio — we only rebalance known tokens
      // Use a case where SOL is the sole seller
      const tokens: TokenAllocation[] = [
        makeAllocation({
          symbol: "SOL",
          caip19: "solana:101/nativeToken:501",
          usdValue: 100,
          priceUsd: 100,
          decimals: 9,
          isNative: true,
        }),
        makeAllocation({
          symbol: "USDC",
          caip19: "solana:101/token:USDC",
          usdValue: 100,
          priceUsd: 1,
          decimals: 6,
          isNative: false,
          mint: "USDC",
        }),
      ];
      const targets: TargetAllocationInput[] = [
        { caip19: "solana:101/nativeToken:501", targetPercent: 20 },
        { caip19: "solana:101/token:USDC", targetPercent: 80 },
      ];

      const plan = computeSwapPlan(tokens, targets, 1.0);
      expect(plan).toHaveLength(1);

      // SOL target = $40, current = $100, raw delta = -$60
      // Reserve = 0.05 SOL * $100 = $5
      // maxSellUsd = $100 - $5 - $40 = $55
      expect(plan[0].sellAmountUsd).toBeCloseTo(55, 0);
    });

    it("does not apply fee reserve to non-SOL sellers", () => {
      const tokens: TokenAllocation[] = [
        makeAllocation({
          symbol: "USDC",
          caip19: "solana:101/token:USDC",
          usdValue: 200,
          priceUsd: 1,
          decimals: 6,
          isNative: false,
          mint: "USDC",
        }),
        makeAllocation({
          symbol: "BONK",
          caip19: "solana:101/token:BONK",
          usdValue: 100,
          priceUsd: 0.00001,
          decimals: 5,
          isNative: false,
          mint: "BONK",
        }),
      ];
      const targets: TargetAllocationInput[] = [
        { caip19: "solana:101/token:USDC", targetPercent: 50 },
        { caip19: "solana:101/token:BONK", targetPercent: 50 },
      ];
      const plan = computeSwapPlan(tokens, targets, 1.0);
      expect(plan).toHaveLength(1);
      // USDC should sell exactly $50 (no fee reserve)
      expect(plan[0].sellAmountUsd).toBeCloseTo(50, 0);
    });
  });

  describe("empty / zero portfolio", () => {
    it("returns empty plan for zero total USD", () => {
      const tokens: TokenAllocation[] = [makeAllocation({ usdValue: 0, priceUsd: 0 })];
      const targets: TargetAllocationInput[] = [{ caip19: "solana:101/nativeToken:501", targetPercent: 100 }];
      expect(computeSwapPlan(tokens, targets, 1.0)).toEqual([]);
    });

    it("returns empty plan for empty tokens array", () => {
      expect(computeSwapPlan([], [{ caip19: "x", targetPercent: 100 }], 1.0)).toEqual([]);
    });
  });

  describe("four-token complex rebalance", () => {
    // Portfolio: A $400 (40%), B $300 (30%), C $200 (20%), D $100 (10%) = $1000
    // Target: A 25%, B 25%, C 25%, D 25%
    const tokens: TokenAllocation[] = [
      makeAllocation({
        symbol: "A",
        caip19: "solana:101/token:A",
        usdValue: 400,
        priceUsd: 10,
        decimals: 6,
        isNative: false,
        mint: "A",
      }),
      makeAllocation({
        symbol: "B",
        caip19: "solana:101/token:B",
        usdValue: 300,
        priceUsd: 5,
        decimals: 6,
        isNative: false,
        mint: "B",
      }),
      makeAllocation({
        symbol: "C",
        caip19: "solana:101/token:C",
        usdValue: 200,
        priceUsd: 2,
        decimals: 6,
        isNative: false,
        mint: "C",
      }),
      makeAllocation({
        symbol: "D",
        caip19: "solana:101/token:D",
        usdValue: 100,
        priceUsd: 1,
        decimals: 6,
        isNative: false,
        mint: "D",
      }),
    ];

    it("produces correct swap plan for equal-weight rebalance", () => {
      const targets: TargetAllocationInput[] = [
        { caip19: "solana:101/token:A", targetPercent: 25 },
        { caip19: "solana:101/token:B", targetPercent: 25 },
        { caip19: "solana:101/token:C", targetPercent: 25 },
        { caip19: "solana:101/token:D", targetPercent: 25 },
      ];

      const plan = computeSwapPlan(tokens, targets, 1.0);

      // A: delta = -$150 (seller), B: delta = -$50 (seller)
      // C: delta = +$50 (buyer), D: delta = +$150 (buyer)
      // Greedy: A(-150) pairs with D(+150) → swap $150; B(-50) pairs with C(+50) → swap $50
      expect(plan).toHaveLength(2);

      const totalSold = plan.reduce((s, p) => s + p.sellAmountUsd, 0);
      expect(totalSold).toBeCloseTo(200, 0);

      // Verify sell amounts include correct base units
      for (const swap of plan) {
        expect(BigInt(swap.sellAmountBaseUnits)).toBeGreaterThan(0n);
      }
    });
  });

  describe("base unit conversion", () => {
    it("computes correct base units for sell amount", () => {
      const tokens: TokenAllocation[] = [
        makeAllocation({
          symbol: "SOL",
          caip19: "solana:101/nativeToken:501",
          usdValue: 200,
          priceUsd: 100,
          decimals: 9,
          isNative: true,
        }),
        makeAllocation({
          symbol: "USDC",
          caip19: "solana:101/token:USDC",
          usdValue: 0.01,
          priceUsd: 1,
          decimals: 6,
          isNative: false,
          mint: "USDC",
        }),
      ];
      const targets: TargetAllocationInput[] = [
        { caip19: "solana:101/nativeToken:501", targetPercent: 50 },
        { caip19: "solana:101/token:USDC", targetPercent: 50 },
      ];

      const plan = computeSwapPlan(tokens, targets, 1.0);
      expect(plan.length).toBeGreaterThan(0);

      // Each swap should have valid base units
      for (const swap of plan) {
        expect(swap.sellAmountBaseUnits).toMatch(/^\d+$/);
        expect(BigInt(swap.sellAmountBaseUnits)).toBeGreaterThan(0n);
      }
    });
  });
});

// ============================================================
// portfolioRebalanceTool — handler integration tests
// ============================================================

describe("portfolioRebalanceTool — schema", () => {
  it("has correct name", () => {
    expect(portfolioRebalanceTool.name).toBe("portfolio_rebalance");
  });

  it("requires phase parameter", () => {
    expect(portfolioRebalanceTool.inputSchema.required).toContain("phase");
  });

  it("has destructive and open-world annotations", () => {
    expect(portfolioRebalanceTool.annotations?.destructiveHint).toBe(true);
    expect(portfolioRebalanceTool.annotations?.openWorldHint).toBe(true);
  });
});

describe("portfolioRebalanceTool — analyze phase", () => {
  const PORTFOLIO_RESPONSE = {
    items: [
      {
        name: "Wrapped SOL",
        symbol: "SOL",
        decimals: 9,
        caip19: "solana:101/nativeToken:501",
        totalQuantity: 5_000_000_000,
        totalQuantityString: "5000000000",
        spamStatus: "VERIFIED",
        price: { price: 150, priceChange24h: 2 },
        queriedWalletBalances: [],
      },
      {
        name: "USD Coin",
        symbol: "USDC",
        decimals: 6,
        caip19: "solana:101/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        totalQuantity: 200_000_000,
        totalQuantityString: "200000000",
        spamStatus: "VERIFIED",
        price: { price: 1, priceChange24h: 0 },
        queriedWalletBalances: [],
      },
      {
        name: "ScamToken",
        symbol: "SCAM",
        decimals: 9,
        caip19: "solana:101/token:SCAM_MINT",
        totalQuantity: 999_000_000_000,
        totalQuantityString: "999000000000",
        spamStatus: "SPAM",
        price: { price: 100, priceChange24h: 0 },
        queriedWalletBalances: [],
      },
    ],
  };

  it("returns allocations with correct percentages", async () => {
    const ctx = makeContext();
    ctx.apiClient.get.mockResolvedValue(PORTFOLIO_RESPONSE);
    const result = (await portfolioRebalanceTool.handler({ phase: "analyze" }, ctx as any)) as any;

    expect(result.phase).toBe("analyze");
    expect(result.network).toBe("solana");
    expect(result.tokens).toHaveLength(2); // SCAM filtered out
    expect(result.tokens[0].symbol).toBe("SOL");
    expect(result.tokens[1].symbol).toBe("USDC");

    // SOL: 5B / 10^9 = 5 SOL * $150 = $750
    // USDC: 200M / 10^6 = 200 USDC * $1 = $200
    // Total = $950
    expect(result.totalUsdValue).toBeCloseTo(950, 0);
    expect(result.tokens[0].currentPercent).toBeCloseTo(78.95, 0);
    expect(result.tokens[1].currentPercent).toBeCloseTo(21.05, 0);
  });
});

describe("portfolioRebalanceTool — execute phase validation", () => {
  it("throws for non-solana network", async () => {
    const ctx = makeContext();
    await expect(portfolioRebalanceTool.handler({ phase: "execute", network: "ethereum" }, ctx as any)).rejects.toThrow(
      "Only 'solana' network",
    );
  });

  it("throws for invalid phase", async () => {
    const ctx = makeContext();
    await expect(portfolioRebalanceTool.handler({ phase: "invalid" }, ctx as any)).rejects.toThrow("Invalid phase");
  });

  it("throws when targetAllocations missing for execute", async () => {
    const ctx = makeContext();
    await expect(portfolioRebalanceTool.handler({ phase: "execute" }, ctx as any)).rejects.toThrow(
      "targetAllocations is required",
    );
  });

  it("throws when targetAllocations don't sum to 100", async () => {
    const ctx = makeContext();
    ctx.apiClient.get.mockResolvedValue({
      items: [
        {
          name: "SOL",
          symbol: "SOL",
          decimals: 9,
          caip19: "solana:101/nativeToken:501",
          totalQuantity: 1_000_000_000,
          totalQuantityString: "1000000000",
          spamStatus: "VERIFIED",
          price: { price: 100, priceChange24h: 0 },
          queriedWalletBalances: [],
        },
      ],
    });

    await expect(
      portfolioRebalanceTool.handler(
        {
          phase: "execute",
          targetAllocations: [{ caip19: "solana:101/nativeToken:501", targetPercent: 50 }],
        },
        ctx as any,
      ),
    ).rejects.toThrow("must sum to 100%");
  });

  it("throws when target caip19 not in portfolio", async () => {
    const ctx = makeContext();
    ctx.apiClient.get.mockResolvedValue({
      items: [
        {
          name: "SOL",
          symbol: "SOL",
          decimals: 9,
          caip19: "solana:101/nativeToken:501",
          totalQuantity: 1_000_000_000,
          totalQuantityString: "1000000000",
          spamStatus: "VERIFIED",
          price: { price: 100, priceChange24h: 0 },
          queriedWalletBalances: [],
        },
      ],
    });

    await expect(
      portfolioRebalanceTool.handler(
        {
          phase: "execute",
          targetAllocations: [
            { caip19: "solana:101/nativeToken:501", targetPercent: 50 },
            { caip19: "solana:101/token:UNKNOWN", targetPercent: 50 },
          ],
        },
        ctx as any,
      ),
    ).rejects.toThrow("not found in current portfolio");
  });
});

describe("portfolioRebalanceTool — execute dry run", () => {
  const PORTFOLIO_RESPONSE = {
    items: [
      {
        name: "SOL",
        symbol: "SOL",
        decimals: 9,
        caip19: "solana:101/nativeToken:501",
        totalQuantity: 3_000_000_000,
        totalQuantityString: "3000000000",
        spamStatus: "VERIFIED",
        price: { price: 100, priceChange24h: 0 },
        queriedWalletBalances: [],
      },
      {
        name: "USDC",
        symbol: "USDC",
        decimals: 6,
        caip19: "solana:101/token:USDC_MINT",
        totalQuantity: 100_000_000,
        totalQuantityString: "100000000",
        spamStatus: "VERIFIED",
        price: { price: 1, priceChange24h: 0 },
        queriedWalletBalances: [],
      },
    ],
  };

  it("returns swap plan without executing when dryRun is true", async () => {
    const ctx = makeContext();
    ctx.apiClient.get.mockResolvedValue(PORTFOLIO_RESPONSE);
    const result = (await portfolioRebalanceTool.handler(
      {
        phase: "execute",
        dryRun: true,
        targetAllocations: [
          { caip19: "solana:101/nativeToken:501", targetPercent: 50 },
          { caip19: "solana:101/token:USDC_MINT", targetPercent: 50 },
        ],
      },
      ctx as any,
    )) as any;

    expect(result.dryRun).toBe(true);
    expect(result.plannedSwaps).toBeDefined();
    expect(result.plannedSwaps.length).toBeGreaterThan(0);
    expect(result.plannedSwaps[0].sell).toBe("SOL");
    expect(result.plannedSwaps[0].buy).toBe("USDC");
    expect(ctx.client.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("returns no-swaps message when portfolio already balanced", async () => {
    const ctx = makeContext();
    ctx.apiClient.get.mockResolvedValue(PORTFOLIO_RESPONSE);
    // SOL: 3B / 10^9 = 3 SOL * $100 = $300
    // USDC: 100M / 10^6 = 100 USDC * $1 = $100
    // Total = $400. SOL = 75%, USDC = 25%
    const result = (await portfolioRebalanceTool.handler(
      {
        phase: "execute",
        dryRun: true,
        targetAllocations: [
          { caip19: "solana:101/nativeToken:501", targetPercent: 75 },
          { caip19: "solana:101/token:USDC_MINT", targetPercent: 25 },
        ],
      },
      ctx as any,
    )) as any;

    expect(result.message).toContain("No swaps needed");
    expect(result.swaps).toEqual([]);
  });
});

describe("portfolioRebalanceTool — execute with swaps", () => {
  const PORTFOLIO_RESPONSE = {
    items: [
      {
        name: "SOL",
        symbol: "SOL",
        decimals: 9,
        caip19: "solana:101/nativeToken:501",
        totalQuantity: 3_000_000_000,
        totalQuantityString: "3000000000",
        spamStatus: "VERIFIED",
        price: { price: 100, priceChange24h: 0 },
        queriedWalletBalances: [],
      },
      {
        name: "USDC",
        symbol: "USDC",
        decimals: 6,
        caip19: "solana:101/token:USDC_MINT",
        totalQuantity: 100_000_000,
        totalQuantityString: "100000000",
        spamStatus: "VERIFIED",
        price: { price: 1, priceChange24h: 0 },
        queriedWalletBalances: [],
      },
    ],
  };

  const QUOTE_RESPONSE = {
    quotes: [{ transactionData: ["base58encodedtx"], sellAmount: "1000000000", buyAmount: "100000000" }],
  };

  it("executes swaps and returns results", async () => {
    const ctx = makeContext();
    ctx.apiClient.get.mockResolvedValue(PORTFOLIO_RESPONSE);
    ctx.apiClient.post.mockResolvedValue(QUOTE_RESPONSE);
    const result = (await portfolioRebalanceTool.handler(
      {
        phase: "execute",
        targetAllocations: [
          { caip19: "solana:101/nativeToken:501", targetPercent: 50 },
          { caip19: "solana:101/token:USDC_MINT", targetPercent: 50 },
        ],
      },
      ctx as any,
    )) as any;

    expect(result.phase).toBe("execute");
    expect(result.swaps.length).toBeGreaterThan(0);
    expect(result.swaps[0].status).toBe("success");
    expect(result.swaps[0].signature).toBe("0xtxhash");
    expect(ctx.client.signAndSendTransaction).toHaveBeenCalled();
  });

  it("reports errors per-swap when a swap fails", async () => {
    const ctx = makeContext();
    ctx.apiClient.get.mockResolvedValue(PORTFOLIO_RESPONSE);
    ctx.apiClient.post.mockRejectedValue(new Error("HTTP 500 — Internal Server Error"));
    const result = (await portfolioRebalanceTool.handler(
      {
        phase: "execute",
        targetAllocations: [
          { caip19: "solana:101/nativeToken:501", targetPercent: 50 },
          { caip19: "solana:101/token:USDC_MINT", targetPercent: 50 },
        ],
      },
      ctx as any,
    )) as any;

    expect(result.swaps[0].status).toBe("error");
    expect(result.swaps[0].error).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
