/**
 * Discord id shape, shared by the panel UI and the worker so both reject the same input.
 * Snowflake: 17–20 digits, nothing else.
 */
export function isDiscordSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}
