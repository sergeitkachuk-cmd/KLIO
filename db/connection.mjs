function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parse once and pass credentials as fields, never through the driver's URL parser.
 * Managed-DB panels can supply a password with unescaped URI delimiters.
 * @param {string} value
 * @returns {{host: string, port: number, database: string, username: string, password: string}}
 */
export function parseDatabaseConnection(value) {
  const input = value.trim();
  try {
    const url = new URL(input);
    if (!/^postgres(?:ql)?:$/.test(url.protocol) || !url.hostname || !url.pathname.slice(1) || url.hash) {
      throw new Error("Invalid PostgreSQL URL");
    }
    return {
      host: decode(url.hostname.replace(/^\[|\]$/g, "")),
      port: Number(url.port || 5432),
      database: decode(url.pathname.slice(1)),
      username: decode(url.username),
      password: decode(url.password),
    };
  } catch {
    const match = /^postgres(?:ql)?:\/\/([^:/?#\s]+):(.+)@(\[[^\]]+\]|[^:/?#\s]+)(?::(\d+))?\/([^?#]+)(?:\?[^#]*)?$/.exec(input);
    const port = Number(match?.[4] || 5432);
    if (!match || port < 1 || port > 65535) {
      // Never attach the original error: URL errors contain the password in input.
      throw new Error("DATABASE_URL is not a valid PostgreSQL connection string.");
    }
    return {
      host: match[3].replace(/^\[|\]$/g, ""),
      port,
      database: decode(match[5]),
      username: decode(match[1]),
      password: decode(match[2]),
    };
  }
}
