import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const input = await FileBlob.load("C:/Users/Msı/Downloads/2026 Yılı Erp ve Çev. Uyg. Md. Tetkik Planı.xlsx");
const workbook = await SpreadsheetFile.importXlsx(input);
const result = await workbook.inspect({
  kind: "workbook,sheet,table,region",
  maxChars: 14000,
  tableMaxRows: 30,
  tableMaxCols: 18,
  tableMaxCellChars: 120,
});
console.log(result.ndjson);
