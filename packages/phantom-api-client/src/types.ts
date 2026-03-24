export interface X402Response {
  error: string;
  limitType: "daily";
  payment: {
    network: string;
    token: string;
    amount: string;
    preparedTx: string;
    description: string;
  };
}

export interface X429Response {
  error: string;
  retryAfterMs: number;
}
