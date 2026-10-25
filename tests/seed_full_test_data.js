import { getDatabase } from '../server/db.js';
import ExcelJS from 'exceljs';
import { parseAndValidateSalesFile, confirmSalesImport } from '../server/influencer-sales.js';

async function seed() {
  const db = getDatabase();

  const { rows: users } = await db.query("SELECT id FROM inv.users WHERE email = 'owner@example.test'");
  const actor = users[0] || { id: '41c2bedb-6698-4de9-8f0b-e6ce9c8b8ddc' };

  // 1. Nizamabad_pilla
  const nizamabadId = 'b03a950a-4286-4f41-a189-60195e330002';
  const { rows: infNizamabad } = await db.query('SELECT id FROM inv.influencers WHERE id = $1', [nizamabadId]);
  if (!infNizamabad.length) {
    await db.query(`
      INSERT INTO inv.influencers (
        id, legal_name, display_name, instagram_username, instagram_url,
        phone, email, address, city, state_code, postal_code, country,
        status, internal_notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      nizamabadId, 'Ramya Madhuri', 'Nizamabad_pilla', '@nizamabad_pilla__19',
      'https://instagram.com/nizamabad_pilla__19', '', '', 'Yellammagutta', 'Nizamabad',
      '36', '503001', 'India', 'ACTIVE', 'Reference influencer partner', actor.id
    ]);
  }

  // Active Agreement for Nizamabad_pilla (50% Net Sales Ex GST, Inclusive Mode)
  const nizamabadAgId = 'c03a950a-4286-4f41-a189-60195e330003';
  const { rows: agNizamabad } = await db.query('SELECT id FROM inv.influencer_agreements WHERE id = $1', [nizamabadAgId]);
  if (!agNizamabad.length) {
    await db.query(`
      INSERT INTO inv.influencer_agreements (
        id, contract_number, influencer_id, title, brand_name, product_name, version, status,
        branding_mode, commission_basis_points, commission_basis, custom_basis_description,
        product_tax_mode, commission_tax_terms, influencer_gst_registered, influencer_gstin,
        withholding_tax_rate_bp, withholding_section, start_date, is_indefinite,
        payment_frequency, payment_due_days, minimum_payout_minor, deliverables, custom_clauses,
        special_terms, signatory_name, signatory_title, influencer_signatory_name, created_by
      ) VALUES (
        $1, 'NC/INF/2026-27/0003', $2, 'Influencer Agreement', 'Nextora Creations', 'Nextora POS Mobile', 1, 'ACTIVE',
        'BOTH', 5000, 'NET_SALES_EX_GST', '',
        'INCLUSIVE', 'EXCLUSIVE', 0, '',
        0, '194H', '2026-10-01', 1,
        'MONTHLY', 15, 0, '[]', '[]',
        '', 'Praveen', 'Founder & Director', 'Ramya Madhuri', $3
      )
    `, [nizamabadAgId, nizamabadId, actor.id]);
  } else {
    await db.query(`UPDATE inv.influencer_agreements SET status = 'ACTIVE' WHERE id = $1`, [nizamabadAgId]);
  }

  // 2. Rohit Tech Reviews
  const rohitId = 'd03a950a-4286-4f41-a189-60195e330004';
  const { rows: infRohit } = await db.query('SELECT id FROM inv.influencers WHERE id = $1', [rohitId]);
  if (!infRohit.length) {
    await db.query(`
      INSERT INTO inv.influencers (
        id, legal_name, display_name, instagram_username, instagram_url,
        phone, email, address, city, state_code, postal_code, country,
        status, internal_notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      rohitId, 'Rohit Khandelwal', 'Rohit Tech Reviews', '@rohit_tech',
      'https://instagram.com/rohit_tech', '+91 91234 56789', 'rohit@example.test',
      'Connaught Place', 'Delhi', '07', '110001', 'India', 'ACTIVE', 'Tech reviewer', actor.id
    ]);
  }

  // Active Agreement for Rohit (15% Net Sales Ex GST, Exclusive Mode)
  const rohitAgId = 'e03a950a-4286-4f41-a189-60195e330005';
  const { rows: agRohit } = await db.query('SELECT id FROM inv.influencer_agreements WHERE id = $1', [rohitAgId]);
  if (!agRohit.length) {
    await db.query(`
      INSERT INTO inv.influencer_agreements (
        id, contract_number, influencer_id, title, brand_name, product_name, version, status,
        branding_mode, commission_basis_points, commission_basis, custom_basis_description,
        product_tax_mode, commission_tax_terms, influencer_gst_registered, influencer_gstin,
        withholding_tax_rate_bp, withholding_section, start_date, is_indefinite,
        payment_frequency, payment_due_days, minimum_payout_minor, deliverables, custom_clauses,
        special_terms, signatory_name, signatory_title, influencer_signatory_name, created_by
      ) VALUES (
        $1, 'NC/INF/2026-27/0001', $2, 'Influencer Agreement', 'Nextora Creations', 'Nextora POS Desktop', 1, 'ACTIVE',
        'BOTH', 1500, 'NET_SALES_EX_GST', '',
        'EXCLUSIVE', 'EXCLUSIVE', 0, '',
        0, '194H', '2026-10-01', 1,
        'MONTHLY', 15, 0, '[]', '[]',
        '', 'Praveen', 'Founder & Director', 'Rohit Khandelwal', $3
      )
    `, [rohitAgId, rohitId, actor.id]);
  } else {
    await db.query(`UPDATE inv.influencer_agreements SET status = 'ACTIVE' WHERE id = $1`, [rohitAgId]);
  }

  // 3. Clear old test batch and records to re-import cleanly
  await db.query('DELETE FROM inv.influencer_sales_records');
  await db.query('DELETE FROM inv.influencer_sales_batches');
  await db.query('DELETE FROM inv.influencer_attributions');

  // 4. Build Excel and Import
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

  const result = await confirmSalesImport(db, actor, {
    filename: preview.filename,
    file_sha256: preview.file_sha256,
    staged_rows: preview.all_staged_rows,
    allow_duplicates: false,
    notes: 'Q3 2026 verified influencer customer sales',
  });

  console.log(`Confirmed import: ${result.imported_count} records imported!`);

  // Verify stored records
  const { rows: checkRecs } = await db.query(`
    SELECT r.customer_name, r.sale_amount_minor, r.eligible_revenue_minor, r.gst_amount_minor,
           r.calculated_commission_minor, r.commission_rate_bp, i.display_name
    FROM inv.influencer_sales_records r
    LEFT JOIN inv.influencers i ON i.id = r.influencer_id
  `);
  console.log('Stored Records:', checkRecs);
}

seed().catch(console.error);
