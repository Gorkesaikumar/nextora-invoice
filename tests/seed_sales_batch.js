import ExcelJS from 'exceljs';
import { getDatabase } from '../server/db.js';
import { parseAndValidateSalesFile, confirmSalesImport } from '../server/influencer-sales.js';

async function seed() {
  const db = getDatabase();

  // Find owner user
  const { rows: users } = await db.query("SELECT id FROM inv.users WHERE email = 'owner@example.test'");
  const actor = users[0] || { id: '41c2bedb-6698-4de9-8f0b-e6ce9c8b8ddc' };

  // Find Nizamabad_pilla and Rohit
  const { rows: infs } = await db.query("SELECT id, instagram_username, display_name FROM inv.influencers");
  console.log('Available influencers:', infs.map(i => `${i.display_name} (${i.instagram_username})`));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sales');
  const headers = [
    'S.No.', 'Customer Name', 'Business Name', 'Purchased Date', 'Product Name',
    'Expiry Date', 'Customer Location', 'Influencer Name', 'Sale Amount', 'Discount',
    'GST Rate %', 'Refund Amount', 'Order Reference'
  ];
  ws.addRow(headers);

  const rows = [
    [1, 'Vikram Malhotra', 'Saffron Dine', '2026-10-12', 'Nextora POS Desktop', '2027-10-12', 'Delhi', '@rohit_tech', 20000, 0, 18, 0, 'ORD-2026-001'],
    [2, 'Meera Nair', 'Green Leaf Organic', '2026-10-14', 'Nextora POS Mobile', 'Lifetime', 'Nizamabad', '@nizamabad_pilla__19', 5999, 0, 18, 0, 'ORD-2026-002'],
    [3, 'Rajesh Sharma', 'Sharma Sweets', '2026-10-20', 'Nextora POS Mobile', '2027-10-20', 'Hyderabad', 'Nizamabad_pilla', 5999, 0, 18, 0, 'ORD-2026-003'],
    [4, 'Anita Verma', 'Verma Boutique', '2026-09-15', 'Nextora POS Desktop', '2027-09-15', 'Mumbai', 'Rohit Tech Reviews', 15000, 0, 18, 0, 'ORD-2026-004'],
  ];

  for (const r of rows) {
    ws.addRow(r);
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = 'verified_sales_q3_2026.xlsx';

  console.log('Validating sales file...');
  const preview = await parseAndValidateSalesFile(db, buffer, filename);
  console.log(`Validated: ${preview.valid_rows_count} valid, ${preview.invalid_rows_count} invalid, ${preview.duplicate_count} duplicate.`);

  if (preview.duplicate_count > 0 && preview.valid_rows_count === 0) {
    console.log('Records already imported.');
    return;
  }

  const result = await confirmSalesImport(db, actor, {
    filename: preview.filename,
    file_sha256: preview.file_sha256,
    staged_rows: preview.all_staged_rows,
    allow_duplicates: false,
    notes: 'Q3 2026 verified influencer customer sales',
  });

  console.log(`Successfully confirmed import: ${result.imported_count} records imported!`);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
