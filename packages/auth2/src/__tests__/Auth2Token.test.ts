const mockJwtDecode = jest.fn();
jest.mock("jwt-decode", () => ({
  jwtDecode: mockJwtDecode,
}));

import { Auth2Token, Auth2TokenExpiredError } from "../Auth2Token";

const WALLET_URN_PREFIX = "urn:phantom:wallet:";

function makeClaims(overrides: Partial<{ sub: string; client_id: string; a2t: string; aud: string[] }> = {}) {
  return {
    sub: overrides.sub ?? "user-abc",
    client_id: overrides.client_id ?? "client-id-abc",
    ext: { a2t: overrides.a2t ?? "auth2-token-value" },
    aud: overrides.aud ?? [],
  };
}

beforeEach(() => {
  mockJwtDecode.mockReturnValue(makeClaims());
});

describe("Auth2Token", () => {
  describe("fromAccessToken()", () => {
    it("calls jwtDecode with the supplied access token string", () => {
      Auth2Token.fromAccessToken("my.access.token");

      expect(mockJwtDecode).toHaveBeenCalledWith("my.access.token");
    });

    it("returns an Auth2Token instance", () => {
      expect(Auth2Token.fromAccessToken("tok")).toBeInstanceOf(Auth2Token);
    });
  });

  describe("sub getter", () => {
    it("returns the sub claim from the token", () => {
      mockJwtDecode.mockReturnValueOnce(makeClaims({ sub: "subject-xyz" }));

      expect(Auth2Token.fromAccessToken("tok").sub).toBe("subject-xyz");
    });
  });

  describe("clientId getter", () => {
    it("returns the client_id claim from the token", () => {
      mockJwtDecode.mockReturnValueOnce(makeClaims({ client_id: "my-app-client" }));

      expect(Auth2Token.fromAccessToken("tok").clientId).toBe("my-app-client");
    });

    it("returns the default client_id from makeClaims baseline", () => {
      expect(Auth2Token.fromAccessToken("tok").clientId).toBe("client-id-abc");
    });
  });

  describe("a2t getter", () => {
    it("returns a2t when exp is in the future", () => {
      const validA2tClaims = { exp: Math.floor(Date.now() / 1_000) + 3600, iat: 0 };
      mockJwtDecode.mockReturnValueOnce(makeClaims({ a2t: "valid-a2t" })).mockReturnValueOnce(validA2tClaims);

      const token = Auth2Token.fromAccessToken("tok");

      expect(token.a2t).toBe("valid-a2t");
    });

    it("throws Auth2TokenExpiredError when a2t exp is in the past", () => {
      const expiredA2tClaims = { exp: Math.floor(Date.now() / 1_000) - 60, iat: 0 };
      mockJwtDecode.mockReturnValueOnce(makeClaims({ a2t: "expired-a2t" })).mockReturnValueOnce(expiredA2tClaims);

      const token = Auth2Token.fromAccessToken("tok");

      expect(() => token.a2t).toThrow(Auth2TokenExpiredError);
    });
  });

  describe("wallet getter", () => {
    it("returns undefined when aud contains no wallet URN", () => {
      mockJwtDecode.mockReturnValueOnce(makeClaims({ aud: ["https://api.example.com", "other-audience"] }));

      expect(Auth2Token.fromAccessToken("tok").wallet).toBeUndefined();
    });

    it("returns undefined when aud is empty", () => {
      mockJwtDecode.mockReturnValueOnce(makeClaims({ aud: [] }));

      expect(Auth2Token.fromAccessToken("tok").wallet).toBeUndefined();
    });

    it("parses wallet id and derivationIndex from the wallet URN", () => {
      const walletId = "wallet-abc-123";
      const derivationIndex = 2;
      mockJwtDecode.mockReturnValueOnce(makeClaims({ aud: [`${WALLET_URN_PREFIX}${walletId}:${derivationIndex}`] }));

      const wallet = Auth2Token.fromAccessToken("tok").wallet;

      expect(wallet?.id).toBe(walletId);
      expect(wallet?.derivationIndex).toBe(derivationIndex);
    });

    it("parses derivationIndex=0 correctly", () => {
      mockJwtDecode.mockReturnValueOnce(makeClaims({ aud: [`${WALLET_URN_PREFIX}wallet-id:0`] }));

      expect(Auth2Token.fromAccessToken("tok").wallet?.derivationIndex).toBe(0);
    });

    it("picks out the wallet URN when aud contains multiple entries", () => {
      mockJwtDecode.mockReturnValueOnce(
        makeClaims({ aud: ["https://api.example.com", `${WALLET_URN_PREFIX}wallet-xyz:5`, "other-entry"] }),
      );

      const wallet = Auth2Token.fromAccessToken("tok").wallet;

      expect(wallet?.id).toBe("wallet-xyz");
      expect(wallet?.derivationIndex).toBe(5);
    });
  });
});
