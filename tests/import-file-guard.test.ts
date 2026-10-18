import { test, expect } from "bun:test";
import {
  MAX_IMPORT_FILE_BYTES,
  populatedExtent,
  readGuardedJson,
  readGuardedWorkbook,
  readGuardedXlsxBytes,
  type XlsxLike,
} from "../src/lib/excel-import/file-guard.ts";

const ZIP = [0x50, 0x4b, 0x03, 0x04];
function fakeFile(name: string, bytes: number[] | Uint8Array, size?: number) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    name,
    size: size ?? data.byteLength,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    text: async () => new TextDecoder().decode(data),
  };
}
function fakeXlsx(book: ReturnType<XlsxLike["read"]>): () => Promise<XlsxLike> {
  return async () => ({ read: () => book });
}

test("L-4: oversize, wrong extension and non-ZIP content are rejected before parsing", async () => {
  await expect(readGuardedXlsxBytes(fakeFile("a.xlsx", ZIP, MAX_IMPORT_FILE_BYTES + 1))).rejects.toThrow(/حجم/);
  await expect(readGuardedXlsxBytes(fakeFile("a.xls", ZIP))).rejects.toThrow(/XLSX/);
  await expect(readGuardedXlsxBytes(fakeFile("a.xlsm", ZIP))).rejects.toThrow(/XLSX/);
  await expect(readGuardedXlsxBytes(fakeFile("a.xlsx", [0x3c, 0x68, 0x74, 0x6d]))).rejects.toThrow(/ليس XLSX/);
  await expect(readGuardedXlsxBytes(fakeFile("a.xlsx", []))).rejects.toThrow(/فارغ/);
  expect((await readGuardedXlsxBytes(fakeFile("a.XLSX", [...ZIP, 0]))).byteLength).toBe(5);
});

test("L-4: macro workbooks rejected; huge sheets rejected; formatted !ref clamped", async () => {
  const file = fakeFile("a.xlsx", [...ZIP, 1, 2]);
  await expect(
    readGuardedWorkbook(file, {
      loadXlsx: fakeXlsx({ SheetNames: ["S"], Sheets: { S: {} }, vbaraw: new Uint8Array(1) }),
    }),
  ).rejects.toThrow(/ماكرو/);
  await expect(
    readGuardedWorkbook(file, {
      loadXlsx: fakeXlsx({ SheetNames: ["S"], Sheets: { S: { "!ref": "A1:A30000", A30000: { v: 1 } } } }),
    }),
  ).rejects.toThrow(/أكبر من الحد/);
  const sheet: Record<string, unknown> = { "!ref": "A1:XFD1048576", A1: { v: "h" }, C5: { v: 1 } };
  const { workbook } = await readGuardedWorkbook(file, {
    loadXlsx: fakeXlsx({ SheetNames: ["S", "تعليمات"], Sheets: { S: sheet, تعليمات: { "!ref": "A1:A99999", A99999: {} } } }),
    skipSheets: ["تعليمات"],
  });
  expect(workbook.Sheets.S["!ref"]).toBe("A1:C5");
  expect(populatedExtent({ "!ref": "x", B2: {}, D9: {} })).toEqual({ minRow: 1, maxRow: 8, minCol: 1, maxCol: 3 });
});

test("L-4: JSON uploads are size-checked and parse errors are Arabic", async () => {
  const enc = new TextEncoder();
  expect(await readGuardedJson(fakeFile("r.json", enc.encode('[{"a":1}]')))).toEqual([{ a: 1 }]);
  await expect(readGuardedJson(fakeFile("r.json", enc.encode("{"))) ).rejects.toThrow(/JSON غير صالح/);
  await expect(readGuardedJson(fakeFile("r.json", enc.encode("[]"), MAX_IMPORT_FILE_BYTES + 1))).rejects.toThrow(/حجم/);
});
