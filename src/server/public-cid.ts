// Structural CID parsing, including canonical varints and digest length.
function decodeBase32(value: string): Uint8Array | undefined {
  if (!/^b[a-z2-7]+$/.test(value)) return undefined;
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of value.slice(1)) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return undefined;
    accumulator = accumulator * 32 + digit;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      const divisor = 2 ** bits;
      bytes.push(Math.floor(accumulator / divisor));
      accumulator %= divisor;
    }
  }
  if (accumulator !== 0) return undefined;
  return Uint8Array.from(bytes);
}

function decodeBase58(value: string): Uint8Array | undefined {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(0);
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return undefined;
    number = number * BigInt(58) + BigInt(digit);
  }

  const reversed: number[] = [];
  while (number > BigInt(0)) {
    reversed.push(Number(number & BigInt(0xff)));
    number >>= BigInt(8);
  }
  const leadingZeroes = value.match(/^1*/)?.[0].length ?? 0;
  return Uint8Array.from([
    ...new Array<number>(leadingZeroes).fill(0),
    ...reversed.reverse(),
  ]);
}

function readUnsignedVarint(
  bytes: Uint8Array,
  offset: number,
): { value: bigint; next: number } | undefined {
  let value = BigInt(0);
  for (let index = 0; index < 10 && offset + index < bytes.length; index += 1) {
    const byte = bytes[offset + index];
    if (index === 9 && byte > 1) return undefined;
    value |= BigInt(byte & 0x7f) << BigInt(index * 7);
    if ((byte & 0x80) === 0) {
      if (index > 0 && (byte & 0x7f) === 0) return undefined;
      return { value, next: offset + index + 1 };
    }
  }
  return undefined;
}

export function isValidCid(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 128) return false;
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value)) {
    const bytes = decodeBase58(value);
    return (
      bytes?.length === 34 &&
      bytes[0] === 0x12 &&
      bytes[1] === 0x20
    );
  }

  const bytes = decodeBase32(value);
  if (!bytes) return false;
  const version = readUnsignedVarint(bytes, 0);
  if (!version || version.value !== BigInt(1)) return false;
  const codec = readUnsignedVarint(bytes, version.next);
  if (!codec || codec.value === BigInt(0)) return false;
  const hashCode = readUnsignedVarint(bytes, codec.next);
  if (!hashCode || hashCode.value === BigInt(0)) return false;
  const digestLength = readUnsignedVarint(bytes, hashCode.next);
  if (!digestLength || digestLength.value === BigInt(0)) return false;
  return digestLength.value === BigInt(bytes.length - digestLength.next);
}

