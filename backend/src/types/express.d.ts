declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        workshopId: string;
        role: string;
        permissions: string[]; // empty for owner (owner bypasses all checks)
      };
    }
  }
}

export {};
