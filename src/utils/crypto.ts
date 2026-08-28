// AUTHOR : NANDHAKUMAR S V
// DATE : 28/08/2026
// DESCRIPTION : Encryption and decryption utilities
import CryptoJS from 'crypto-js';

// Fixed IV for legacy (v1) encryption only
const LEGACY_IV = CryptoJS.enc.Utf8.parse(
  '\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00',
);

export const hashMD5 = (data: string) => {
  const md5Key = CryptoJS.MD5(data).toString();
  return CryptoJS.enc.Utf8.parse(md5Key);
};

const COMPANY_ID_ALIASES = [
  'InfogID',
  'Infog_CompanyID',
  'InfogCompanyID',
  'infogCompanyID',
  'CompanyID',
  'companyID',
  'MFICompanyID',
  'infogID',
];

/******* NORMALISE COMPANY ID ALIASES *******/
export const normaliseCompanyIdAliases = (data: unknown): unknown => {
  if (!data || typeof data !== 'object') return data;
  const record = data as Record<string, unknown>;
  let canonical: unknown;
  for (const k of COMPANY_ID_ALIASES) {
    if (record[k] !== undefined && record[k] !== null && record[k] !== '') {
      canonical = record[k];
      break;
    }
  }
  if (canonical === undefined) return data;
  const out: Record<string, unknown> = { ...record };
  for (const k of COMPANY_ID_ALIASES) {
    if (out[k] === undefined || out[k] === null || out[k] === '') out[k] = canonical;
  }
  return out;
};

/******* ENCRYPT DATA *******/
export const encryptData = (data: object, key: string): string => {
  const KEY = hashMD5(key);
  const jsonString = JSON.stringify(normaliseCompanyIdAliases(data));
  const encrypted = CryptoJS.AES.encrypt(jsonString, KEY, {
    iv: LEGACY_IV,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return CryptoJS.enc.Hex.stringify(CryptoJS.enc.Base64.parse(encrypted.toString()));
};

/******* ENCRYPT DATA V2 *******/
/** Encrypt format: hex(iv_16_bytes + ciphertext), key = SHA256(keyValue) */
export const encryptDataV2 = (data: object, key: string): string => {
  const KEY = CryptoJS.SHA256(CryptoJS.enc.Utf8.parse(key));
  const iv = CryptoJS.lib.WordArray.random(16);
  const jsonString = JSON.stringify(normaliseCompanyIdAliases(data));
  const encrypted = CryptoJS.AES.encrypt(jsonString, KEY, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const packed = iv.concat(encrypted.ciphertext);
  return packed.toString(CryptoJS.enc.Hex);
};

/******* DECRYPT DATA V2 *******/
const decryptV2 = (encryptedHex: string, key: string) => {
  const KEY = CryptoJS.SHA256(CryptoJS.enc.Utf8.parse(key));
  const hex = encryptedHex.startsWith('v2:') ? encryptedHex.slice(3) : encryptedHex;
  const raw = CryptoJS.enc.Hex.parse(hex);
  const words = raw.words;
  const sigBytes = raw.sigBytes;
  if (sigBytes < 16) {
    return null;
  }
  const iv = CryptoJS.lib.WordArray.create(words.slice(0, 4), 16);
  const cipherWords = words.slice(4);
  const cipherSigBytes = sigBytes - 16;
  const ciphertext = CryptoJS.lib.WordArray.create(cipherWords, cipherSigBytes);
  const cipherBase64 = ciphertext.toString(CryptoJS.enc.Base64);
  const decrypted = CryptoJS.AES.decrypt(cipherBase64, KEY, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return decrypted.toString(CryptoJS.enc.Utf8);
};

/******* DECRYPT DATA *******/
export const decryptData = (encryptedHex: string, key: string) => {
  try {
    if (!encryptedHex || typeof encryptedHex !== 'string' || encryptedHex.trim() === '') {
      return { data: null, response: null };
    }

    let decryptedText: string | null = decryptV2(encryptedHex, key);

    if (!decryptedText) {
      const KEY = hashMD5(key);
      let encryptedBase64: string;
      try {
        encryptedBase64 = CryptoJS.enc.Hex.parse(encryptedHex).toString(CryptoJS.enc.Base64);
      } catch {
        return { data: null, response: null };
      }
      const decrypted = CryptoJS.AES.decrypt(encryptedBase64, KEY, {
        iv: LEGACY_IV,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });
      decryptedText = decrypted.toString(CryptoJS.enc.Utf8);
    }

    if (!decryptedText || decryptedText.trim() === '') {
      return { data: null, response: null };
    }

    try {
      return JSON.parse(decryptedText);
    } catch {
      return { data: null, response: null };
    }
  } catch {
    return { data: null, response: null };
  }
};

/******* IS DECRYPT FAILURE *******/
export const isDecryptFailure = (decoded: unknown): boolean => {
  if (!decoded || typeof decoded !== 'object') return true;
  const record = decoded as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    record.data === null &&
    record.response === null &&
    keys.length <= 2 &&
    keys.every((k) => k === 'data' || k === 'response')
  );
};
