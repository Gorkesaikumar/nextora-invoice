import { randomUUID } from 'node:crypto';
import { assert, HttpError, uuid, basisPoints, minorUnits } from './domain.js';
import { hash } from './auth.js';
import { audit } from './audit.js';
import { allocateNumber, previewNumber } from './numbering.js';
import { percentOf, roundDiv, BP_PER_UNIT } from './money.js';
import { formatMinor } from './words.js';
import { requireWriter } from './service.js';

/* -------------------------------------------------------- Default Clauses */

export const DEFAULT_CONTRACT_CLAUSES = {
  section_2_purpose: `The Influencer agrees to represent and promote Nextora POS as an independent marketing partner of Nextora Creations. The Influencer shall familiarize themselves with the product, understand its features, benefits, and workflows, and present it authentically to their audience as a product they are actively supporting and marketing. Both parties intend to build a mutually beneficial long-term partnership based on transparent communication, measurable marketing activities, and revenue sharing.

The Influencer acknowledges and agrees that they act solely as an independent marketing partner and independent contractor. Nothing in this Agreement shall create, imply, or be construed as creating an employment relationship, partnership, franchise, agency, joint venture, or authorized legal representation of Nextora Creations. The Influencer has no authority to bind, commit, or incur obligations on behalf of Nextora Creations, nor make unsupported product claims, warranties, or unauthorized commitments.`,

  section_4_revenue_terms: `Commission calculations are strictly based on the agreed revenue-sharing percentage applied to the designated commission calculation basis.

1. Qualifying Eligible Sales: An eligible sale is defined as a verified, successfully paid subscription, license, or purchase of Nextora POS directly attributable to the Influencer through authorized tracking mechanisms (including assigned referral codes, tracking URLs, or approved customer attribution records).
2. Attribution Window & Deductions: Transactions subject to chargebacks, cancellations, approved refunds, bad debts, or unpaid invoices shall not generate commission, and any commission previously credited for such transactions shall be adjusted against future payouts.
3. Tax Integrity: GST collected by Nextora Creations on behalf of tax authorities does not constitute commissionable revenue under Net Revenue calculation bases. Influencer commission invoices shall be subject to applicable statutory tax deduction at source (TDS) as per prevailing income tax regulations.
4. Threshold & Monthly Commission Settlement: Subject to reconciliation of verified eligible sales, applicable deductions, and any required documentation, commission payments shall be processed during the first week of each calendar month for the preceding settlement period, provided accrued earnings meet or exceed the agreed minimum payout threshold. The payable amount shall be calculated using the agreed commission rate on eligible net sales revenue excluding GST, after accounting for approved refunds, cancellations, chargebacks, and other agreed adjustments. Balances below the threshold carry forward to the subsequent settlement cycle.
5. Pending Commissions at Expiry: Upon termination or expiry without breach, verified commissions earned up to the effective date of termination shall be settled in accordance with standard reconciliation schedules.`,

  section_5_conduct_obligations: `The Influencer agrees to maintain professional conduct and protect brand reputation at all times:
1. Authentic Representation: All demonstrations, reviews, and promotional content must reflect genuine user experience, accurate product capabilities, and truthful statements regarding Nextora POS.
2. Compliance with Advertising Standards: The Influencer shall strictly comply with applicable consumer protection guidelines, FTC/ASCI influencer disclosure requirements, and social media platform rules, clearly displaying "#Ad", "#Sponsored", or "Paid Partnership" disclosures.
3. Prohibited Conduct: The Influencer shall not make exaggerated, false, or misleading claims regarding features, sales, profits, or business outcomes. The Influencer shall not offer unauthorized discounts, rebates, or financial commitments on behalf of Nextora Creations.
4. Confidentiality & Privacy: The Influencer shall not access, disclose, misuse, or distribute any proprietary software code, customer data, unreleased features, or confidential commercial terms.`,

  section_6_brand_intellectual_property: `Nextora Creations retains exclusive ownership of all trademarks, trade names, brand logos, software copyrights, patents, and proprietary intellectual property related to Nextora POS and Nextora Creations.

1. Limited License: Nextora Creations grants the Influencer a limited, revocable, non-exclusive, non-transferable license to use the Nextora POS product logo and approved brand assets solely for executing the agreed marketing deliverables during the term of this Agreement.
2. Creative Approval: Any customized promotional collateral, banners, or major campaign assets bearing company trademarks must conform to brand guidelines and receive written approval prior to public distribution.
3. Content Reuse: Unless otherwise agreed, the Influencer grants Nextora Creations a non-exclusive, worldwide, royalty-free license to repost, share, demonstrate, and archive influencer-created promotional posts, reels, and video demonstrations across Nextora Creations digital and social channels for commercial marketing purposes.`,

  section_7_payment_invoicing: `1. Reconciliation & Reporting: Nextora Creations shall provide periodic commission statements detailing attributed eligible transactions, deductions, and calculated revenue share.
2. Invoicing & Documentation: The Influencer shall submit a valid invoice (including GST invoice if GST-registered, or payment receipt) together with required PAN and banking details.
3. Statutory Deductions: Nextora Creations shall deduct applicable Tax Deducted at Source (TDS) pursuant to Section 194H or 194J of the Income Tax Act, 1961, and furnish corresponding TDS certificates (Form 16A) in accordance with statutory timelines.
4. Monthly Payment Settlement: Subject to reconciliation of verified eligible sales, applicable deductions, and any required documentation, commission payments shall be processed during the first week of each calendar month for the preceding settlement period. Approved commissions shall be remitted via electronic bank transfer (NEFT/RTGS/IMPS/UPI) to the Influencer's designated bank account following verification.`,

  section_8_term_termination: `1. Term: This Agreement commences on the Start Date and continues until the End Date, or indefinitely if so configured, unless earlier terminated in accordance with this section.
2. Termination for Convenience: Either party may terminate this Agreement by providing thirty (30) days prior written notice to the other party.
3. Immediate Termination for Cause: Nextora Creations reserves the right to terminate this Agreement immediately upon written notice in the event of material breach, fraudulent attribution, deceptive advertising, unlawful conduct, or acts that cause material damage to brand reputation.
4. Post-Termination Rights: Termination shall not affect commissions properly earned and verified prior to termination. The Influencer shall promptly cease using company trademarks and brand assets upon termination.`,

  section_9_general_legal: `1. Entire Agreement: This Agreement, together with configured deliverables and commercial schedules, constitutes the entire agreement between the parties regarding influencer marketing and supersedes all prior representations or negotiations.
2. Amendments: No modification, amendment, or waiver of any provision of this Agreement shall be effective unless recorded in writing and executed by authorized representatives of both parties.
3. Severability: If any provision of this Agreement is held invalid or unenforceable, the remaining provisions shall remain in full force and effect.
4. Governing Law & Jurisdiction: This Agreement shall be governed by and construed in accordance with the laws of India. Any disputes arising out of or in connection with this Agreement shall be subject to the exclusive jurisdiction of the competent courts in the State where Nextora Creations has its principal place of business.
5. Non-Disparagement & Survival: Confidentiality, intellectual property rights, and accrued payment obligations shall survive the expiration or termination of this Agreement.`
};

/* ------------------------------------------------- Illustrative Calculation */

export function calculateIllustrativeCommission({
  commission_basis_points = 1000,
  commission_basis = 'NET_SALES_EX_GST',
  product_tax_mode = 'EXCLUSIVE',
  commission_tax_terms = 'EXCLUSIVE',
  withholding_tax_rate_bp = 500, // 5% TDS
  sample_sale_amount_minor = 1000000, // ₹10,000.00
  sample_gst_rate_bp = 1800, // 18% GST
  sample_refund_minor = 100000, // ₹1,000.00
} = {}) {
  const sampleSale = sample_sale_amount_minor;
  let netEligibleRevenue = sampleSale;
  let gstCollected = 0;
  let grossCustomerPayment = sampleSale;

  if (product_tax_mode === 'INCLUSIVE') {
    netEligibleRevenue = roundDiv(sampleSale * BP_PER_UNIT, BP_PER_UNIT + sample_gst_rate_bp);
    gstCollected = sampleSale - netEligibleRevenue;
    grossCustomerPayment = sampleSale;
  } else {
    netEligibleRevenue = sampleSale;
    gstCollected = percentOf(netEligibleRevenue, sample_gst_rate_bp);
    grossCustomerPayment = netEligibleRevenue + gstCollected;
  }

  let commissionBaseMinor = netEligibleRevenue;
  let basisExplanation = '';

  if (commission_basis === 'NET_SALES_EX_GST') {
    commissionBaseMinor = netEligibleRevenue;
    basisExplanation = 'Net product sales revenue excluding GST.';
  } else if (commission_basis === 'COLLECTED_NET_REFUNDS') {
    const netAfterRefunds = Math.max(0, netEligibleRevenue - sample_refund_minor);
    commissionBaseMinor = netAfterRefunds;
    basisExplanation = `Net collected revenue after approved refunds (assumes ₹${(sample_refund_minor / 100).toFixed(2)} refund adjustment).`;
  } else if (commission_basis === 'GROSS_COLLECTED') {
    commissionBaseMinor = grossCustomerPayment;
    basisExplanation = 'Gross customer collections including taxes.';
  } else {
    commissionBaseMinor = netEligibleRevenue;
    basisExplanation = 'Custom contract calculation basis.';
  }

  const grossCommissionMinor = percentOf(commissionBaseMinor, commission_basis_points);
  const withholdingMinor = withholding_tax_rate_bp > 0
    ? percentOf(grossCommissionMinor, withholding_tax_rate_bp)
    : 0;
  const netCommissionPayableMinor = Math.max(0, grossCommissionMinor - withholdingMinor);

  return {
    sample_sale_minor: sampleSale,
    gst_collected_minor: gstCollected,
    gross_customer_payment_minor: grossCustomerPayment,
    commission_base_minor: commissionBaseMinor,
    commission_rate_bp: commission_basis_points,
    commission_percentage: (commission_basis_points / 100).toFixed(2),
    basis_explanation: basisExplanation,
    gross_commission_minor: grossCommissionMinor,
    withholding_tax_rate_bp,
    withholding_minor: withholdingMinor,
    net_commission_payable_minor: netCommissionPayableMinor,
    disclaimer: 'ILLUSTRATIVE CALCULATION EXAMPLE ONLY: The figures above are provided strictly for illustrative and explanatory purposes to demonstrate the calculation mechanics agreed herein. They do not constitute a guarantee, forecast, or representation of minimum or expected earnings.'
  };
}

export function calculateContractProductIllustrations(commissionBasisPoints = 5000) {
  const rateBp = commissionBasisPoints > 0 ? commissionBasisPoints : 5000;
  const ratePercent = (rateBp / 100).toFixed(2);

  // Product 1: Nextora POS Mobile App (₹5,999.00 GST-inclusive @ 18% GST)
  const mobileGrossMinor = 599900;
  const mobileNetMinor = 508390; // 599900 * 100 / 118 rounded
  const mobileGstMinor = 91510;
  const mobileCommMinor = Math.round((mobileNetMinor * rateBp) / 10000); // 254195 @ 50%
  const mobileCgstMinor = 45755;
  const mobileSgstMinor = 45755;

  // Product 2: Nextora POS Desktop (₹7,999.00 GST-inclusive @ 18% GST)
  const desktopGrossMinor = 799900;
  const desktopNetMinor = 677881; // 799900 * 100 / 118 rounded
  const desktopGstMinor = 122019;
  const desktopCommMinor = Math.round((desktopNetMinor * rateBp) / 10000); // 338941 @ 50%
  const desktopCgstMinor = 61010;
  const desktopSgstMinor = 61009; // 610.10 + 610.09 = 1,220.19

  return {
    commission_rate_bp: rateBp,
    commission_percentage: ratePercent,
    disclaimer: 'Illustrative calculation based on the listed retail prices and the stated GST rate. Actual commission is calculated on verified eligible sales under this agreement, subject to applicable cancellations, refunds, chargebacks, and other agreed adjustments.',
    products: [
      {
        name: 'Nextora POS Mobile App',
        gross_sale_minor: mobileGrossMinor,
        gst_rate_percent: '18%',
        gst_amount_minor: mobileGstMinor,
        net_sale_minor: mobileNetMinor,
        commission_rate_percent: `${ratePercent}%`,
        commission_minor: mobileCommMinor,
        intra_state_telangana: {
          cgst_rate: '9%',
          cgst_minor: mobileCgstMinor,
          sgst_rate: '9%',
          sgst_minor: mobileSgstMinor,
          total_gst_minor: mobileGstMinor,
        },
        interstate: {
          igst_rate: '18%',
          igst_minor: mobileGstMinor,
          total_gst_minor: mobileGstMinor,
        },
      },
      {
        name: 'Nextora POS Desktop',
        gross_sale_minor: desktopGrossMinor,
        gst_rate_percent: '18%',
        gst_amount_minor: desktopGstMinor,
        net_sale_minor: desktopNetMinor,
        commission_rate_percent: `${ratePercent}%`,
        commission_minor: desktopCommMinor,
        intra_state_telangana: {
          cgst_rate: '9%',
          cgst_minor: desktopCgstMinor,
          sgst_rate: '9%',
          sgst_minor: desktopSgstMinor,
          total_gst_minor: desktopGstMinor,
        },
        interstate: {
          igst_rate: '18%',
          igst_minor: desktopGstMinor,
          total_gst_minor: desktopGstMinor,
        },
      },
    ],
  };
}

/* ------------------------------------------------ Influencer Management */

export async function listInfluencers(db, { search = '', status = '', page = 1, limit = 25 } = {}) {
  const offset = (Math.max(1, Number(page || 1)) - 1) * Number(limit || 25);
  const conditions = [];
  const params = [];

  if (search?.trim()) {
    params.push(`%${search.trim().replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_')}%`);
    const p = params.length;
    conditions.push(`(legal_name ILIKE $${p} ESCAPE '!' OR display_name ILIKE $${p} ESCAPE '!' OR instagram_username ILIKE $${p} ESCAPE '!' OR email ILIKE $${p} ESCAPE '!' OR phone ILIKE $${p} ESCAPE '!')`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countSql = `SELECT count(*)::integer AS total FROM inv.influencers ${whereClause}`;
  const total = (await db.query(countSql, params)).rows[0]?.total || 0;

  const dataSql = `
    SELECT i.*,
      (SELECT count(*)::integer FROM inv.influencer_agreements a WHERE a.influencer_id = i.id) AS agreement_count,
      (SELECT count(*)::integer FROM inv.influencer_agreements a WHERE a.influencer_id = i.id AND a.status = 'ACTIVE') AS active_agreement_count,
      (SELECT COALESCE(SUM(commission_minor), 0) FROM inv.influencer_attributions at WHERE at.influencer_id = i.id AND at.status IN ('VERIFIED','PAID')) AS total_verified_commission_minor
    FROM inv.influencers i
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const { rows } = await db.query(dataSql, [...params, limit, offset]);

  return { influencers: rows, total, page: Number(page), limit: Number(limit) };
}

export async function getInfluencer(db, id) {
  const { rows } = await db.query(`
    SELECT i.*,
      (SELECT count(*)::integer FROM inv.influencer_agreements a WHERE a.influencer_id = i.id) AS agreement_count,
      (SELECT count(*)::integer FROM inv.influencer_agreements a WHERE a.influencer_id = i.id AND a.status = 'ACTIVE') AS active_agreement_count,
      (SELECT COALESCE(SUM(commission_minor), 0) FROM inv.influencer_attributions at WHERE at.influencer_id = i.id AND at.status IN ('VERIFIED','PAID')) AS total_verified_commission_minor
    FROM inv.influencers i
    WHERE i.id = $1
  `, [id]);
  assert(rows[0], 404, 'Influencer not found.', 'INFLUENCER_NOT_FOUND');
  return rows[0];
}

export async function checkInfluencerDuplicates(db, input, excludeId = null) {
  const warnings = [];
  const handle = input.instagram_username?.trim().toLowerCase();
  const normalizedHandle = handle?.startsWith('@') ? handle : `@${handle}`;

  if (normalizedHandle && normalizedHandle.length > 1) {
    const { rows } = await db.query(
      `SELECT id, legal_name, display_name, instagram_username FROM inv.influencers WHERE lower(instagram_username) = lower($1) AND ($2::uuid IS NULL OR id <> $2)`,
      [normalizedHandle, excludeId]
    );
    if (rows.length > 0) {
      warnings.push(`An influencer with Instagram handle ${normalizedHandle} already exists (${rows[0].display_name} - ${rows[0].legal_name}).`);
    }
  }

  if (input.email?.trim()) {
    const emailNorm = input.email.trim().toLowerCase();
    const { rows } = await db.query(
      `SELECT id, legal_name, display_name, email FROM inv.influencers WHERE lower(email) = lower($1) AND ($2::uuid IS NULL OR id <> $2)`,
      [emailNorm, excludeId]
    );
    if (rows.length > 0) {
      warnings.push(`An influencer with email "${input.email.trim()}" already exists (${rows[0].display_name}).`);
    }
  }

  if (input.phone?.trim()) {
    const cleanPhone = input.phone.trim().replace(/[^0-9]/g, '');
    if (cleanPhone.length >= 7) {
      const { rows } = await db.query(
        `SELECT id, display_name, phone FROM inv.influencers WHERE ($1::uuid IS NULL OR id <> $1)`,
        [excludeId]
      );
      for (const r of rows) {
        const storedClean = (r.phone || '').replace(/[^0-9]/g, '');
        if (storedClean && (storedClean.endsWith(cleanPhone) || cleanPhone.endsWith(storedClean))) {
          warnings.push(`An influencer with matching phone number already exists (${r.display_name}: ${r.phone}).`);
          break;
        }
      }
    }
  }

  return { warnings };
}

export async function createInfluencer(db, actor, input) {
  const id = randomUUID();
  const handle = input.instagram_username.trim().toLowerCase();
  const normalizedHandle = handle.startsWith('@') ? handle : `@${handle}`;

  const dupCheck = await checkInfluencerDuplicates(db, { ...input, instagram_username: normalizedHandle }, null);

  const { rows } = await db.query(`
    INSERT INTO inv.influencers (
      id, legal_name, display_name, instagram_username, instagram_url, phone, email,
      address, city, state_code, postal_code, country, niche, follower_count,
      other_social_links, profile_image_url, internal_notes, status, created_by, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, now(), now()
    ) RETURNING *
  `, [
    id, input.legal_name.trim(), input.display_name.trim(), normalizedHandle,
    input.instagram_url || '', input.phone || '', input.email || '',
    input.address || '', input.city || '', input.state_code || '', input.postal_code || '',
    input.country || 'India', input.niche || '', input.follower_count || 0,
    input.other_social_links || '', input.profile_image_url || '', input.internal_notes || '',
    input.status || 'ACTIVE', actor.id
  ]);

  await audit(db, 'INFLUENCER_CREATED', {
    actorId: actor.id, entityType: 'INFLUENCER', entityId: id,
    metadata: { legal_name: input.legal_name, instagram_username: normalizedHandle }
  });

  return { influencer: rows[0], warnings: dupCheck.warnings };
}

export async function updateInfluencer(db, actor, id, input) {
  const existing = await getInfluencer(db, id);
  const handle = (input.instagram_username || existing.instagram_username).trim().toLowerCase();
  const normalizedHandle = handle.startsWith('@') ? handle : `@${handle}`;

  const dupCheck = await checkInfluencerDuplicates(db, { ...input, instagram_username: normalizedHandle }, id);

  const { rows } = await db.query(`
    UPDATE inv.influencers SET
      legal_name = $1, display_name = $2, instagram_username = $3, instagram_url = $4,
      phone = $5, email = $6, address = $7, city = $8, state_code = $9,
      postal_code = $10, country = $11, niche = $12, follower_count = $13,
      other_social_links = $14, profile_image_url = $15, internal_notes = $16,
      status = $17, updated_at = now()
    WHERE id = $18
    RETURNING *
  `, [
    input.legal_name?.trim() || existing.legal_name,
    input.display_name?.trim() || existing.display_name,
    normalizedHandle,
    input.instagram_url !== undefined ? input.instagram_url : existing.instagram_url,
    input.phone !== undefined ? input.phone : existing.phone,
    input.email !== undefined ? input.email : existing.email,
    input.address !== undefined ? input.address : existing.address,
    input.city !== undefined ? input.city : existing.city,
    input.state_code !== undefined ? input.state_code : existing.state_code,
    input.postal_code !== undefined ? input.postal_code : existing.postal_code,
    input.country !== undefined ? input.country : existing.country,
    input.niche !== undefined ? input.niche : existing.niche,
    input.follower_count !== undefined ? input.follower_count : existing.follower_count,
    input.other_social_links !== undefined ? input.other_social_links : existing.other_social_links,
    input.profile_image_url !== undefined ? input.profile_image_url : existing.profile_image_url,
    input.internal_notes !== undefined ? input.internal_notes : existing.internal_notes,
    input.status || existing.status,
    id
  ]);

  await audit(db, 'INFLUENCER_UPDATED', {
    actorId: actor.id, entityType: 'INFLUENCER', entityId: id,
    metadata: { legal_name: rows[0].legal_name, status: rows[0].status }
  });

  return { influencer: rows[0], warnings: dupCheck.warnings };
}

/* ------------------------------------------- Agreement Management */

export async function listAgreements(db, { influencerId = null, status = '', search = '', page = 1, limit = 25 } = {}) {
  const offset = (Math.max(1, Number(page || 1)) - 1) * Number(limit || 25);
  const conditions = [];
  const params = [];

  if (influencerId) {
    params.push(influencerId);
    conditions.push(`a.influencer_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (search?.trim()) {
    params.push(`%${search.trim().replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_')}%`);
    const p = params.length;
    conditions.push(`(a.contract_number ILIKE $${p} ESCAPE '!' OR a.title ILIKE $${p} ESCAPE '!' OR i.legal_name ILIKE $${p} ESCAPE '!' OR i.instagram_username ILIKE $${p} ESCAPE '!')`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countSql = `
    SELECT count(*)::integer AS total
    FROM inv.influencer_agreements a
    JOIN inv.influencers i ON i.id = a.influencer_id
    ${whereClause}
  `;
  const total = (await db.query(countSql, params)).rows[0]?.total || 0;

  const dataSql = `
    SELECT a.*,
      i.legal_name AS influencer_legal_name,
      i.display_name AS influencer_display_name,
      i.instagram_username AS influencer_instagram_username,
      i.email AS influencer_email,
      i.phone AS influencer_phone
    FROM inv.influencer_agreements a
    JOIN inv.influencers i ON i.id = a.influencer_id
    ${whereClause}
    ORDER BY a.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const { rows } = await db.query(dataSql, [...params, limit, offset]);

  return { agreements: rows, total, page: Number(page), limit: Number(limit) };
}

export async function getAgreement(db, id) {
  const { rows } = await db.query(`
    SELECT a.*,
      i.legal_name AS influencer_legal_name,
      i.display_name AS influencer_display_name,
      i.instagram_username AS influencer_instagram_username,
      i.instagram_url AS influencer_instagram_url,
      i.email AS influencer_email,
      i.phone AS influencer_phone,
      i.address AS influencer_address,
      i.city AS influencer_city,
      i.state_code AS influencer_state_code,
      i.postal_code AS influencer_postal_code,
      i.country AS influencer_country
    FROM inv.influencer_agreements a
    JOIN inv.influencers i ON i.id = a.influencer_id
    WHERE a.id = $1
  `, [id]);
  assert(rows[0], 404, 'Agreement not found.', 'AGREEMENT_NOT_FOUND');
  return rows[0];
}

export async function createAgreement(db, actor, input) {
  // Verify influencer exists
  const influencer = await getInfluencer(db, input.influencer_id);

  const { rows: settingsRows } = await db.query('SELECT * FROM inv.business_settings WHERE id = true');
  const business = settingsRows[0] || {};
  const prefix = business.influencer_contract_prefix || 'NC/INF';

  return db.transaction(async tx => {
    const allocated = await allocateNumber(tx, {
      docType: 'INFLUENCER_AGREEMENT',
      prefix,
      date: input.start_date || new Date().toISOString().slice(0, 10),
    });

    const id = randomUUID();
    const deliverablesJson = typeof input.deliverables === 'string'
      ? input.deliverables
      : JSON.stringify(input.deliverables || []);
    const customClausesJson = typeof input.custom_clauses === 'string'
      ? input.custom_clauses
      : JSON.stringify({ ...DEFAULT_CONTRACT_CLAUSES, ...(input.custom_clauses || {}) });

    const signatoryName = input.signatory_name?.trim() || business.signatory_name || 'Authorized Signatory';
    const signatoryTitle = input.signatory_title?.trim() || business.signatory_title || 'Director';
    const influencerSignatory = input.influencer_signatory_name?.trim() || influencer.legal_name;

    const { rows } = await tx.query(`
      INSERT INTO inv.influencer_agreements (
        id, contract_number, influencer_id, title, brand_name, product_name, version,
        status, branding_mode, commission_basis_points, commission_basis, custom_basis_description,
        product_tax_mode, commission_tax_terms, influencer_gst_registered, influencer_gstin,
        withholding_tax_rate_bp, withholding_section, start_date, end_date, is_indefinite,
        payment_frequency, payment_due_days, minimum_payout_minor, deliverables,
        custom_clauses, special_terms, signatory_name, signatory_title, influencer_signatory_name,
        created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 1,
        'DRAFT', $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18, $19,
        $20, $21, $22, $23,
        $24, $25, $26, $27, $28,
        $29, now(), now()
      ) RETURNING *
    `, [
      id, allocated.number, input.influencer_id, input.title || 'Influencer Marketing & Revenue-Sharing Agreement — Nextora POS',
      input.brand_name || 'Nextora Creations', input.product_name || 'Nextora POS',
      input.branding_mode || 'BOTH',
      input.commission_basis_points, input.commission_basis || 'NET_SALES_EX_GST', input.custom_basis_description || '',
      input.product_tax_mode || 'EXCLUSIVE', input.commission_tax_terms || 'EXCLUSIVE',
      input.influencer_gst_registered ? 1 : 0, input.influencer_gstin || '',
      input.withholding_tax_rate_bp || 0, input.withholding_section || '194H',
      input.start_date, input.is_indefinite ? null : input.end_date, input.is_indefinite ? 1 : 0,
      input.payment_frequency || 'MONTHLY', input.payment_due_days || 15,
      input.minimum_payout_minor ?? 100000,
      deliverablesJson, customClausesJson, input.special_terms || '',
      signatoryName, signatoryTitle, influencerSignatory,
      actor.id
    ]);

    await audit(tx, 'AGREEMENT_CREATED', {
      actorId: actor.id, entityType: 'AGREEMENT', entityId: id,
      metadata: { contract_number: allocated.number, influencer_id: input.influencer_id, commission_bp: input.commission_basis_points }
    });

    return rows[0];
  });
}

export async function updateAgreementDraft(db, actor, id, input) {
  const existing = await getAgreement(db, id);
  assert(existing.status === 'DRAFT' || existing.status === 'PENDING_APPROVAL', 400,
    `Agreement terms cannot be altered in ${existing.status} status. Duplicate as a new draft to modify finalized agreements.`,
    'AGREEMENT_IMMUTABLE');

  const deliverablesJson = input.deliverables !== undefined
    ? (typeof input.deliverables === 'string' ? input.deliverables : JSON.stringify(input.deliverables))
    : (typeof existing.deliverables === 'string' ? existing.deliverables : JSON.stringify(existing.deliverables || []));

  const existingClauses = typeof existing.custom_clauses === 'string'
    ? JSON.parse(existing.custom_clauses || '{}')
    : (existing.custom_clauses || {});

  const customClausesJson = input.custom_clauses !== undefined
    ? (typeof input.custom_clauses === 'string' ? input.custom_clauses : JSON.stringify({ ...existingClauses, ...input.custom_clauses }))
    : JSON.stringify(existingClauses);

  const isIndefinite = input.is_indefinite !== undefined
    ? (input.is_indefinite ? 1 : 0)
    : (existing.is_indefinite ? 1 : 0);
  const endDate = isIndefinite === 1
    ? null
    : (input.end_date !== undefined ? input.end_date : existing.end_date);

  const { rows } = await db.query(`
    UPDATE inv.influencer_agreements SET
      title = $1, brand_name = $2, product_name = $3,
      commission_basis_points = $4, commission_basis = $5, custom_basis_description = $6,
      product_tax_mode = $7, commission_tax_terms = $8,
      influencer_gst_registered = $9, influencer_gstin = $10,
      withholding_tax_rate_bp = $11, withholding_section = $12,
      start_date = $13, end_date = $14, is_indefinite = $15,
      payment_frequency = $16, payment_due_days = $17, minimum_payout_minor = $18,
      deliverables = $19, custom_clauses = $20, special_terms = $21,
      signatory_name = $22, signatory_title = $23, influencer_signatory_name = $24,
      branding_mode = $25,
      updated_at = now()
    WHERE id = $26
    RETURNING *
  `, [
    input.title || existing.title,
    input.brand_name || existing.brand_name,
    input.product_name || existing.product_name,
    input.commission_basis_points ?? existing.commission_basis_points,
    input.commission_basis || existing.commission_basis,
    input.custom_basis_description !== undefined ? input.custom_basis_description : existing.custom_basis_description,
    input.product_tax_mode || existing.product_tax_mode,
    input.commission_tax_terms || existing.commission_tax_terms,
    input.influencer_gst_registered !== undefined ? (input.influencer_gst_registered ? 1 : 0) : (existing.influencer_gst_registered ? 1 : 0),
    input.influencer_gstin !== undefined ? input.influencer_gstin : existing.influencer_gstin,
    input.withholding_tax_rate_bp ?? existing.withholding_tax_rate_bp,
    input.withholding_section || existing.withholding_section,
    input.start_date || existing.start_date,
    endDate,
    isIndefinite,
    input.payment_frequency || existing.payment_frequency,
    input.payment_due_days ?? existing.payment_due_days,
    input.minimum_payout_minor ?? existing.minimum_payout_minor,
    deliverablesJson,
    customClausesJson,
    input.special_terms !== undefined ? input.special_terms : existing.special_terms,
    input.signatory_name || existing.signatory_name,
    input.signatory_title || existing.signatory_title,
    input.influencer_signatory_name || existing.influencer_signatory_name,
    input.branding_mode || existing.branding_mode || 'BOTH',
    id
  ]);

  await audit(db, 'AGREEMENT_UPDATED', {
    actorId: actor.id, entityType: 'AGREEMENT', entityId: id,
    metadata: { contract_number: rows[0].contract_number, commission_bp: rows[0].commission_basis_points }
  });

  return rows[0];
}

export async function transitionAgreementStatus(db, actor, id, { action, reason = '', note = '', date = '' }) {
  const existing = await getAgreement(db, id);
  let newStatus = existing.status;
  const updates = [];
  const params = [];

  const addField = (col, val) => {
    params.push(val);
    updates.push(`${col} = $${params.length}`);
  };

  if (action === 'SUBMIT_APPROVAL') {
    assert(existing.status === 'DRAFT', 400, 'Only draft agreements can be submitted for approval.', 'INVALID_TRANSITION');
    newStatus = 'PENDING_APPROVAL';
  } else if (action === 'APPROVE') {
    assert(existing.status === 'PENDING_APPROVAL', 400, 'Only pending agreements can be approved.', 'INVALID_TRANSITION');
    newStatus = 'DRAFT'; // Approved draft ready for sending
    addField('approved_by', actor.id);
  } else if (action === 'SEND') {
    assert(['DRAFT', 'PENDING_APPROVAL'].includes(existing.status), 400, 'Agreement cannot be marked as sent from its current state.', 'INVALID_TRANSITION');
    newStatus = 'SENT';
    addField('sent_at', date ? `${date}T00:00:00Z` : new Date().toISOString());
  } else if (action === 'ACCEPT') {
    assert(['SENT', 'DRAFT'].includes(existing.status), 400, 'Agreement cannot be marked as accepted from its current state.', 'INVALID_TRANSITION');
    newStatus = 'ACCEPTED';
    addField('accepted_at', date ? `${date}T00:00:00Z` : new Date().toISOString());
  } else if (action === 'SIGN') {
    assert(['ACCEPTED', 'SENT', 'DRAFT'].includes(existing.status), 400, 'Agreement cannot be marked as signed from its current state.', 'INVALID_TRANSITION');
    newStatus = 'SIGNED';
    addField('signed_at', date ? `${date}T00:00:00Z` : new Date().toISOString());
  } else if (action === 'ACTIVATE') {
    assert(['SIGNED', 'ACCEPTED'].includes(existing.status), 400, 'Only signed or accepted agreements can be activated.', 'INVALID_TRANSITION');
    newStatus = 'ACTIVE';
  } else if (action === 'TERMINATE') {
    assert(existing.status !== 'TERMINATED', 400, 'Agreement is already terminated.', 'ALREADY_TERMINATED');
    newStatus = 'TERMINATED';
    addField('terminated_at', new Date().toISOString());
    addField('termination_reason', reason || note || 'Terminated by administrator');
  } else if (action === 'ARCHIVE') {
    assert(existing.status !== 'ARCHIVED', 400, 'Agreement is already archived.', 'ALREADY_ARCHIVED');
    newStatus = 'ARCHIVED';
  } else if (action === 'CANCEL') {
    assert(existing.status !== 'CANCELLED', 400, 'Agreement is already cancelled.', 'ALREADY_CANCELLED');
    newStatus = 'CANCELLED';
    addField('terminated_at', new Date().toISOString());
    addField('termination_reason', reason || note || 'Agreement cancelled');
  } else {
    throw new HttpError(400, `Unknown transition action ${action}`, 'UNKNOWN_ACTION');
  }

  addField('status', newStatus);
  addField('updated_at', new Date().toISOString());
  params.push(id);

  const { rows } = await db.query(`
    UPDATE inv.influencer_agreements
    SET ${updates.join(', ')}
    WHERE id = $${params.length}
    RETURNING *
  `, params);

  await audit(db, 'AGREEMENT_STATUS_CHANGED', {
    actorId: actor.id, entityType: 'AGREEMENT', entityId: id,
    metadata: { contract_number: rows[0].contract_number, from: existing.status, to: newStatus, action, reason }
  });

  return rows[0];
}

export async function deleteDraftAgreement(db, actor, id) {
  requireWriter(actor);
  const existing = await getAgreement(db, id);
  assert(['DRAFT', 'PENDING_APPROVAL'].includes(existing.status), 409,
    `Only unexecuted draft agreements can be deleted (current status: ${existing.status}). Please cancel or archive finalized contracts instead.`,
    'NOT_DELETABLE');

  // Check if any sales attributions reference this agreement
  const { rows: attrRows } = await db.query('SELECT count(*)::int AS total FROM inv.influencer_attributions WHERE agreement_id = $1', [id]);
  assert(Number(attrRows[0]?.total || 0) === 0, 409,
    'This agreement has attributed customer sales or commissions and cannot be deleted.', 'AGREEMENT_IN_USE');

  await db.query('DELETE FROM inv.influencer_agreements WHERE id = $1', [id]);
  await audit(db, 'AGREEMENT_DRAFT_DELETED', {
    actorId: actor.id,
    entityType: 'AGREEMENT',
    entityId: id,
    metadata: { contract_number: existing.contract_number },
  });
  return { deleted: true, contract_number: existing.contract_number };
}

export async function deleteInfluencer(db, actor, id) {
  requireWriter(actor);
  const { rows: infRows } = await db.query('SELECT * FROM inv.influencers WHERE id = $1', [id]);
  assert(infRows[0], 404, 'Influencer not found.', 'NOT_FOUND');

  const { rows: agrRows } = await db.query('SELECT count(*)::int AS total FROM inv.influencer_agreements WHERE influencer_id = $1', [id]);
  assert(Number(agrRows[0]?.total || 0) === 0, 409,
    'This creator has existing contracts and cannot be deleted. You can archive the influencer instead.', 'INFLUENCER_IN_USE');

  const { rows: attrRows } = await db.query('SELECT count(*)::int AS total FROM inv.influencer_attributions WHERE influencer_id = $1', [id]);
  assert(Number(attrRows[0]?.total || 0) === 0, 409,
    'This creator has tracked customer sales attributions and cannot be deleted. You can archive the influencer instead.', 'INFLUENCER_IN_USE');

  await db.query('DELETE FROM inv.influencers WHERE id = $1', [id]);
  await audit(db, 'INFLUENCER_DELETED', {
    actorId: actor.id,
    entityType: 'INFLUENCER',
    entityId: id,
    metadata: { legal_name: infRows[0].legal_name },
  });
  return { deleted: true, legal_name: infRows[0].legal_name };
}

export async function duplicateAgreement(db, actor, id) {
  const original = await getAgreement(db, id);
  const { rows: settingsRows } = await db.query('SELECT * FROM inv.business_settings WHERE id = true');
  const business = settingsRows[0] || {};
  const prefix = business.influencer_contract_prefix || 'NC/INF';

  return db.transaction(async tx => {
    const allocated = await allocateNumber(tx, {
      docType: 'INFLUENCER_AGREEMENT',
      prefix,
      date: new Date().toISOString().slice(0, 10),
    });

    const newId = randomUUID();
    const deliverablesJson = typeof original.deliverables === 'string'
      ? original.deliverables
      : JSON.stringify(original.deliverables || []);
    const customClausesJson = typeof original.custom_clauses === 'string'
      ? original.custom_clauses
      : JSON.stringify(original.custom_clauses || {});

    const { rows } = await tx.query(`
      INSERT INTO inv.influencer_agreements (
        id, contract_number, influencer_id, title, brand_name, product_name, version,
        status, commission_basis_points, commission_basis, custom_basis_description,
        product_tax_mode, commission_tax_terms, influencer_gst_registered, influencer_gstin,
        withholding_tax_rate_bp, withholding_section, start_date, end_date, is_indefinite,
        payment_frequency, payment_due_days, minimum_payout_minor, deliverables,
        custom_clauses, special_terms, signatory_name, signatory_title, influencer_signatory_name,
        created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        'DRAFT', $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18, $19,
        $20, $21, $22, $23,
        $24, $25, $26, $27, $28,
        $29, now(), now()
      ) RETURNING *
    `, [
      newId, allocated.number, original.influencer_id, `${original.title} (Copy)`,
      original.brand_name, original.product_name, Number(original.version || 1) + 1,
      original.commission_basis_points, original.commission_basis, original.custom_basis_description,
      original.product_tax_mode, original.commission_tax_terms, original.influencer_gst_registered, original.influencer_gstin,
      original.withholding_tax_rate_bp, original.withholding_section,
      new Date().toISOString().slice(0, 10), original.end_date, original.is_indefinite,
      original.payment_frequency, original.payment_due_days, original.minimum_payout_minor,
      deliverablesJson, customClausesJson, original.special_terms,
      original.signatory_name, original.signatory_title, original.influencer_signatory_name,
      actor.id
    ]);

    await audit(tx, 'AGREEMENT_DUPLICATED', {
      actorId: actor.id, entityType: 'AGREEMENT', entityId: newId,
      metadata: { original_id: id, original_number: original.contract_number, new_number: allocated.number }
    });

    return rows[0];
  });
}

/* ------------------------------------------- Contract Snapshot & PDF */

export async function buildContractSnapshot(db, agreementId) {
  const agreement = await getAgreement(db, agreementId);
  const { rows: settingsRows } = await db.query('SELECT * FROM inv.business_settings WHERE id = true');
  const business = settingsRows[0] || {};

  const deliverables = typeof agreement.deliverables === 'string'
    ? JSON.parse(agreement.deliverables || '[]')
    : (agreement.deliverables || []);

  const customClauses = typeof agreement.custom_clauses === 'string'
    ? JSON.parse(agreement.custom_clauses || '{}')
    : (agreement.custom_clauses || {});

  const clauses = {
    ...DEFAULT_CONTRACT_CLAUSES,
    ...customClauses,
  };

  const baseIllustrative = calculateIllustrativeCommission({
    commission_basis_points: agreement.commission_basis_points,
    commission_basis: agreement.commission_basis,
    product_tax_mode: agreement.product_tax_mode,
    commission_tax_terms: agreement.commission_tax_terms,
    withholding_tax_rate_bp: agreement.withholding_tax_rate_bp,
    sample_sale_amount_minor: 1000000, // ₹10,000.00
    sample_gst_rate_bp: business.default_tax_rate_bp || 1800,
    sample_refund_minor: 100000, // ₹1,000.00
  });
  const productIllustrations = calculateContractProductIllustrations(agreement.commission_basis_points);
  const illustrativeCalculation = {
    ...baseIllustrative,
    ...productIllustrations,
    disclaimer: baseIllustrative.disclaimer,
    products_disclaimer: productIllustrations.disclaimer,
  };

  return {
    contract_id: agreement.id,
    contract_number: agreement.contract_number,
    version: agreement.version,
    status: agreement.status,
    title: agreement.title,
    branding_mode: agreement.branding_mode || 'BOTH',
    brand_name: agreement.brand_name || 'Nextora Creations',
    product_name: agreement.product_name || 'Nextora POS',
    created_at: agreement.created_at,
    updated_at: agreement.updated_at,
    pdf_generated_at: agreement.pdf_generated_at,
    effective_start_date: agreement.start_date,
    effective_end_date: agreement.is_indefinite ? null : agreement.end_date,
    is_indefinite: Boolean(agreement.is_indefinite),
    payment_frequency: agreement.payment_frequency,
    payment_due_days: agreement.payment_due_days,
    minimum_payout_minor: agreement.minimum_payout_minor,

    commercial_terms: {
      commission_percentage: (agreement.commission_basis_points / 100).toFixed(2),
      commission_basis_points: agreement.commission_basis_points,
      commission_basis: agreement.commission_basis,
      custom_basis_description: agreement.custom_basis_description,
      product_tax_mode: agreement.product_tax_mode,
      commission_tax_terms: agreement.commission_tax_terms,
      influencer_gst_registered: Boolean(agreement.influencer_gst_registered),
      influencer_gstin: agreement.influencer_gstin,
      withholding_tax_rate_bp: agreement.withholding_tax_rate_bp,
      withholding_percentage: (agreement.withholding_tax_rate_bp / 100).toFixed(2),
      withholding_section: agreement.withholding_section,
    },

    deliverables,
    clauses,
    special_terms: agreement.special_terms,

    business: {
      business_name: business.business_name || 'Nextora Creations',
      legal_name: business.legal_name || 'Nextora Creations',
      address: business.address || '',
      email: business.email || '',
      phone: business.phone || '',
      website: business.website || '',
      gstin: business.gstin || '',
      pan: business.pan || '',
      signatory_name: agreement.signatory_name || business.signatory_name || 'Authorized Signatory',
      signatory_title: agreement.signatory_title || business.signatory_title || 'Director',
      pdf_accent_color: business.pdf_accent_color || '#00AEEF',
    },

    influencer: {
      id: agreement.influencer_id,
      legal_name: agreement.influencer_legal_name,
      display_name: agreement.influencer_display_name,
      instagram_username: agreement.influencer_instagram_username,
      instagram_url: agreement.influencer_instagram_url,
      email: agreement.influencer_email,
      phone: agreement.influencer_phone,
      address: agreement.influencer_address,
      city: agreement.influencer_city,
      state_code: agreement.influencer_state_code,
      postal_code: agreement.influencer_postal_code,
      country: agreement.influencer_country,
      signatory_name: agreement.influencer_signatory_name || agreement.influencer_legal_name,
    },

    illustrative_calculation: illustrativeCalculation,
  };
}

export async function recordPdfGenerated(db, actor, id, snapshot) {
  const snapshotJson = JSON.stringify(snapshot);
  const now = new Date().toISOString();

  await db.query(`
    UPDATE inv.influencer_agreements
    SET pdf_generated_at = $1, snapshot = $2, updated_at = now()
    WHERE id = $3
  `, [now, snapshotJson, id]);

  await audit(db, 'AGREEMENT_PDF_GENERATED', {
    actorId: actor.id, entityType: 'AGREEMENT', entityId: id,
    metadata: { contract_number: snapshot.contract_number, generated_at: now }
  });
}

/* ---------------------------------------------- Marketing Dashboard */

export async function marketingDashboard(db) {
  const totalInfluencers = (await db.query(`SELECT count(*)::integer AS count FROM inv.influencers WHERE status <> 'ARCHIVED'`)).rows[0]?.count || 0;
  const activePartnerships = (await db.query(`SELECT count(*)::integer AS count FROM inv.influencer_agreements WHERE status = 'ACTIVE'`)).rows[0]?.count || 0;
  const pendingApprovals = (await db.query(`SELECT count(*)::integer AS count FROM inv.influencer_agreements WHERE status = 'PENDING_APPROVAL'`)).rows[0]?.count || 0;
  const generatedContracts = (await db.query(`SELECT count(*)::integer AS count FROM inv.influencer_agreements WHERE pdf_generated_at IS NOT NULL`)).rows[0]?.count || 0;

  // Real attribution totals:
  const attributionStats = (await db.query(`
    SELECT
      count(*)::integer AS total_attributions,
      COALESCE(SUM(CASE WHEN status IN ('VERIFIED','PAID') THEN net_revenue_minor ELSE 0 END), 0)::bigint AS verified_net_revenue_minor,
      COALESCE(SUM(CASE WHEN status = 'VERIFIED' THEN commission_minor ELSE 0 END), 0)::bigint AS verified_commission_payable_minor,
      COALESCE(SUM(CASE WHEN status = 'PAID' THEN commission_minor ELSE 0 END), 0)::bigint AS paid_commission_minor
    FROM inv.influencer_attributions
  `)).rows[0] || { total_attributions: 0, verified_net_revenue_minor: 0, verified_commission_payable_minor: 0, paid_commission_minor: 0 };

  return {
    total_influencers: totalInfluencers,
    active_partnerships: activePartnerships,
    contracts_awaiting_approval: pendingApprovals,
    contracts_generated: generatedContracts,
    total_attributed_revenue_minor: Number(attributionStats.verified_net_revenue_minor || 0),
    total_commission_payable_minor: Number(attributionStats.verified_commission_payable_minor || 0),
    total_commission_paid_minor: Number(attributionStats.paid_commission_minor || 0),
    has_verified_attribution: Number(attributionStats.total_attributions || 0) > 0,
  };
}

/* ---------------------------------------------------- Brand Logos */

export function extractImageDimensions(bytes, isPng, isJpg) {
  if (isPng) {
    if (bytes.length < 24) return { width: 0, height: 0 };
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  if (isJpg) {
    let offset = 2;
    while (offset < bytes.length - 8) {
      if (bytes[offset] !== 0xFF) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
        const height = bytes.readUInt16BE(offset + 5);
        const width = bytes.readUInt16BE(offset + 7);
        return { width, height };
      }
      if (marker >= 0xC0 && marker <= 0xFE && marker !== 0xD8 && marker !== 0xD9) {
        const segLength = bytes.readUInt16BE(offset + 2);
        offset += 2 + segLength;
      } else {
        offset += 2;
      }
    }
    return { width: 512, height: 512 };
  }
  return { width: 0, height: 0 };
}

export async function saveBrandLogo(db, actor, base64, name = 'product_logo') {
  assert(['company_logo', 'product_logo'].includes(name), 400, 'Invalid logo target asset.', 'INVALID_ASSET');

  const raw = String(base64).replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
  const bytes = Buffer.from(raw, 'base64');
  assert(bytes.length >= 24 && bytes.length <= 1048576, 413, 'The logo must be between 24 bytes and 1 MB.', 'INVALID_UPLOAD');

  // Verify PNG or JPEG magic bytes
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpg = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  assert(isPng || isJpg, 415, 'The logo must be a valid PNG or JPEG image.', 'INVALID_UPLOAD');

  const { width, height } = extractImageDimensions(bytes, isPng, isJpg);
  assert(width >= 1 && height >= 1 && width <= 2500 && height <= 2500, 400, 'The logo dimensions are out of range (must be between 1x1 and 2500x2500).', 'INVALID_UPLOAD');
  const mimeType = isPng ? 'image/png' : 'image/jpeg';

  const sha = hash(bytes.toString('base64'));

  await db.transaction(async tx => {
    await tx.query(`
      INSERT INTO inv.brand_assets (name, png, sha256, mime_type, width, height, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT(name) DO UPDATE SET
        png = EXCLUDED.png, sha256 = EXCLUDED.sha256, mime_type = EXCLUDED.mime_type,
        width = EXCLUDED.width, height = EXCLUDED.height,
        updated_by = EXCLUDED.updated_by, updated_at = now()
    `, [name, bytes, sha, mimeType, width, height, actor.id]);

    await audit(tx, name === 'product_logo' ? 'PRODUCT_LOGO_UPDATED' : 'COMPANY_LOGO_UPDATED', {
      actorId: actor.id, entityType: 'BRAND_ASSET', metadata: { name, bytes: bytes.length, width, height }
    });
  });

  return { name, bytes: bytes.length, width, height, mime_type: mimeType };
}

export async function brandLogoBytes(db, name = 'product_logo') {
  // First check brand_assets
  const { rows } = await db.query(`SELECT png, mime_type FROM inv.brand_assets WHERE name = $1`, [name]);
  if (rows[0]?.png) return { bytes: rows[0].png, mimeType: rows[0].mime_type || 'image/png' };

  // Fallback to company_assets if name is company_logo
  if (name === 'company_logo') {
    const fallback = (await db.query(`SELECT png FROM inv.company_assets WHERE name = 'company_logo'`)).rows[0];
    if (fallback?.png) return { bytes: fallback.png, mimeType: 'image/png' };
  }

  return null;
}

export async function getBrandAssetsSummary(db) {
  const prod = await brandLogoBytes(db, 'product_logo');
  const comp = await brandLogoBytes(db, 'company_logo');

  const { rows: prodRows } = await db.query(`SELECT width, height FROM inv.brand_assets WHERE name = 'product_logo'`).catch(() => ({ rows: [] }));
  const { rows: compRows } = await db.query(`SELECT width, height FROM inv.brand_assets WHERE name = 'company_logo'`).catch(() => ({ rows: [] }));

  return {
    product_logo: prod?.bytes ? {
      exists: true,
      mimeType: prod.mimeType,
      bytes: prod.bytes.length,
      width: prodRows[0]?.width || 0,
      height: prodRows[0]?.height || 0,
      dataUri: `data:${prod.mimeType};base64,${Buffer.from(prod.bytes).toString('base64')}`,
    } : { exists: false },
    company_logo: comp?.bytes ? {
      exists: true,
      mimeType: comp.mimeType,
      bytes: comp.bytes.length,
      width: compRows[0]?.width || 0,
      height: compRows[0]?.height || 0,
      dataUri: `data:${comp.mimeType};base64,${Buffer.from(comp.bytes).toString('base64')}`,
    } : { exists: false },
  };
}
