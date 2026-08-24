/** Payment links stay payable for three calendar days. Kept shared so the
 * checkout request and the account history never disagree about expiry. */
export const PAYMENT_LINK_TTL_MINUTES = 3 * 24 * 60;
export const PAYMENT_LINK_TTL_MS = PAYMENT_LINK_TTL_MINUTES * 60 * 1000;
