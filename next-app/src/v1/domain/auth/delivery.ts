/**
 * OTP delivery port — Production Resend adapter is CF-V1-AUTH-002.
 */

export interface OtpDeliveryAdapter {
  deliver(email: string, code: string): Promise<void>;
}

/** In-memory adapter for smoke tests only — never sends real mail. */
export class InMemoryOtpDeliveryAdapter implements OtpDeliveryAdapter {
  readonly deliveries: Array<{ email: string; code: string }> = [];
  failNext = false;

  async deliver(email: string, code: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("DELIVERY_ADAPTER_FORCED_FAILURE");
    }
    this.deliveries.push({ email, code });
  }

  lastCodeFor(email: string): string | undefined {
    const hits = this.deliveries.filter((d) => d.email === email);
    return hits[hits.length - 1]?.code;
  }

  clear(): void {
    this.deliveries.length = 0;
  }
}
