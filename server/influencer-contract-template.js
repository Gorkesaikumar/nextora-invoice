import { formatDate, formatMinor } from './words.js';

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderInfluencerContractHtml(snapshot, {
  companyLogoDataUri = null,
  productLogoDataUri = null,
  standalone = false,
} = {}) {
  const s = snapshot || {};
  const b = s.business || {};
  const inf = s.influencer || {};
  const c = s.commercial_terms || {};
  const calc = s.illustrative_calculation || {};
  const deliverables = s.deliverables || [];
  const clauses = s.clauses || {};
  const accentColor = b.pdf_accent_color || '#00AEEF';

  const mode = s.branding_mode || 'BOTH';
  const allowCompany = mode === 'BOTH' || mode === 'COMPANY_ONLY';
  const allowProduct = mode === 'BOTH' || mode === 'PRODUCT_ONLY';

  const resolvedCompanyLogo = companyLogoDataUri || s.company_logo?.data_uri || '';
  const resolvedProductLogo = productLogoDataUri || s.product_logo?.data_uri || '';

  const showCompany = allowCompany && Boolean(resolvedCompanyLogo);
  const showProduct = allowProduct && Boolean(resolvedProductLogo);

  const businessContacts = [
    b.email ? `Email: ${esc(b.email)}` : null,
    b.phone ? `Phone: ${esc(b.phone)}` : null,
    b.website ? `Web: <a href="${esc(b.website)}" target="_blank" rel="noopener">${esc(b.website)}</a>` : null,
  ].filter(Boolean);

  const influencerLocation = [inf.address, inf.city, inf.postal_code, inf.country]
    .filter(Boolean)
    .join(', ');

  const influencerContacts = [
    inf.email ? `Email: ${esc(inf.email)}` : 'Email: —',
    inf.phone ? `Phone: ${esc(inf.phone)}` : 'Phone: —',
  ].join(' · ');

  // Products calculation list
  const products = (calc.products && calc.products.length > 0)
    ? calc.products
    : [
        {
          name: 'Nextora POS Mobile App',
          gross_sale_minor: 599900,
          gst_rate_percent: '18%',
          gst_amount_minor: 91510,
          net_sale_minor: 508390,
          commission_rate_percent: `${c.commission_percentage || '50.00'}%`,
          commission_minor: 254195,
        },
        {
          name: 'Nextora POS Desktop',
          gross_sale_minor: 799900,
          gst_rate_percent: '18%',
          gst_amount_minor: 122019,
          net_sale_minor: 677881,
          commission_rate_percent: `${c.commission_percentage || '50.00'}%`,
          commission_minor: 338941,
        },
      ];

  const bodyContent = `
<div class="nc-influencer-doc">
  <!-- ==================== PAGE 1: HEADER, METADATA, SECTIONS 1, 2, 3 ==================== -->
  <div class="nc-a4-page" data-page="1">
    <div class="nc-page-content">
      <div class="nc-top-stripe"></div>

      <!-- Document Header -->
      <header class="nc-contract-header">
        <div class="nc-header-left">
          ${showCompany ? `
            <div class="nc-company-logo-wrap">
              <img src="${esc(resolvedCompanyLogo)}" alt="${esc(b.business_name || 'Nextora Creations')}" class="nc-company-logo">
            </div>
          ` : ''}
          <div class="nc-business-details">
            <h2 class="nc-business-title">${esc(b.business_name || 'NEXTORA CREATIONS')}</h2>
            <p class="nc-business-legal">${esc(b.legal_name || 'Nextora Creations Software Solutions')}</p>
            <p class="nc-business-address">${esc(b.address || 'Ambedkar colony, Nizamabad, Telangana 503001')}</p>
            <p class="nc-business-contacts">${businessContacts.join(' · ')}</p>
            <p class="nc-business-tax font-mono">
              GSTIN: ${esc(b.gstin || '36JTAPK9167A1ZK')} &nbsp;·&nbsp; PAN: ${esc(b.pan || 'JTAPK9167A')}
            </p>
          </div>
        </div>

        <div class="nc-header-right">
          ${showProduct ? `
            <div class="nc-product-logo-wrap">
              <img src="${esc(resolvedProductLogo)}" alt="${esc(s.product_name || 'Nextora POS')}" class="nc-product-logo">
            </div>
          ` : `
            <div class="nc-product-title">${esc(s.product_name || 'Nextora POS')}</div>
            <div class="nc-product-sub">Product Marketing Partnership</div>
          `}
          <div class="nc-header-contract-pill font-mono">CONTRACT #${esc(s.contract_number || 'NC/INF/2026-27/0001')}</div>
        </div>
      </header>

      <div class="nc-header-divider"></div>

      <!-- Contract Title Banner -->
      <div class="nc-title-banner">
        <h1 class="nc-doc-title">${esc((s.title || 'INFLUENCER MARKETING & REVENUE-SHARING AGREEMENT — NEXTORA POS').toUpperCase())}</h1>
        <p class="nc-doc-subtitle">Marketing Partnership &amp; Commercial Revenue-Sharing Terms</p>
      </div>

      <!-- Summary Metadata 4-Column Table -->
      <div class="nc-meta-grid">
        <div class="nc-meta-col">
          <div class="nc-meta-label">CONTRACT NUMBER</div>
          <div class="nc-meta-val font-mono font-bold">${esc(s.contract_number || 'NC/INF/2026-27/0001')}</div>
          <div class="nc-meta-sub">Version ${esc(s.version || 1)} · Status: ${esc(s.status || 'DRAFT')}</div>
        </div>
        <div class="nc-meta-col">
          <div class="nc-meta-label">EFFECTIVE START DATE</div>
          <div class="nc-meta-val">${formatDate(s.effective_start_date)}</div>
          <div class="nc-meta-sub">${s.is_indefinite ? 'Duration: Indefinite' : 'Until: ' + formatDate(s.effective_end_date)}</div>
        </div>
        <div class="nc-meta-col">
          <div class="nc-meta-label">REVENUE SHARE</div>
          <div class="nc-meta-val font-bold text-accent">${esc(c.commission_percentage || '50.00')}%</div>
          <div class="nc-meta-sub">Basis: ${esc(String(c.commission_basis || 'NET_SALES_EX_GST').replace(/_/g, ' '))}</div>
        </div>
        <div class="nc-meta-col">
          <div class="nc-meta-label">GST TREATMENT</div>
          <div class="nc-meta-val">Sales: GST ${esc(c.product_tax_mode || 'EXCLUSIVE')}</div>
          <div class="nc-meta-sub">Commission: GST ${esc(c.commission_tax_terms || 'EXCLUSIVE')}</div>
        </div>
      </div>

      <!-- SECTION 1: PARTIES TO THE AGREEMENT -->
      <section class="nc-section">
        <div class="nc-section-heading">
          <span class="nc-heading-accent"></span>
          <h3 class="nc-heading-text">SECTION 1: PARTIES TO THE AGREEMENT</h3>
        </div>
        <div class="nc-parties-grid">
          <div class="nc-party-card">
            <div class="nc-party-label">BRAND &amp; PRODUCT OWNER:</div>
            <div class="nc-party-name">${esc(b.business_name || 'Nextora Creations')}</div>
            <div class="nc-party-sub">Owner of ${esc(s.product_name || 'Nextora POS')}</div>
            <div class="nc-party-line">Address: ${esc(b.address || 'Ambedkar colony, Nizamabad, Telangana 503001')}</div>
            <div class="nc-party-meta font-mono">GSTIN: ${esc(b.gstin || '36JTAPK9167A1ZK')} · PAN: ${esc(b.pan || 'JTAPK9167A')}</div>
            <div class="nc-party-contact">Contact: ${esc(b.email || 'support@nextoracreations.co.in')}</div>
          </div>
          <div class="nc-party-card">
            <div class="nc-party-label">MARKETING PARTNER / INFLUENCER:</div>
            <div class="nc-party-name">${esc(inf.legal_name || 'Influencer Partner')}</div>
            <div class="nc-party-sub">Display Name: ${esc(inf.display_name || inf.legal_name || '—')} · Handle: ${esc(inf.instagram_username || '—')}</div>
            <div class="nc-party-line">Address: ${esc(influencerLocation || '—')}</div>
            <div class="nc-party-contact">${esc(influencerContacts)}</div>
            <div class="nc-party-meta">GST Status: ${c.influencer_gst_registered ? `Registered (${esc(c.influencer_gstin || '')})` : 'Unregistered'}</div>
          </div>
        </div>
      </section>

      <!-- SECTION 2: PURPOSE OF THE PARTNERSHIP -->
      <section class="nc-section">
        <div class="nc-section-heading">
          <span class="nc-heading-accent"></span>
          <h3 class="nc-heading-text">SECTION 2: PURPOSE OF THE PARTNERSHIP</h3>
        </div>
        <div class="nc-clauses-body">
          ${String(clauses.section_2_purpose || '')
            .split('\n\n')
            .map(p => p.trim() ? `<p class="nc-clause-p">${esc(p)}</p>` : '')
            .join('')}
        </div>
      </section>

      <!-- SECTION 3: SCOPE OF WORK & MARKETING DELIVERABLES -->
      <section class="nc-section">
        <div class="nc-section-heading">
          <span class="nc-heading-accent"></span>
          <h3 class="nc-heading-text">SECTION 3: SCOPE OF WORK &amp; MARKETING DELIVERABLES</h3>
        </div>
        <p class="nc-intro-p">The Influencer agrees to deliver the promotional commitments outlined below during the term of this Agreement:</p>
        ${deliverables.length ? `
          <div class="nc-table-wrap">
            <table class="nc-data-table">
              <thead>
                <tr>
                  <th class="text-left">DELIVERABLE</th>
                  <th class="text-center w-24">MIN. QTY</th>
                  <th class="text-left">FREQUENCY</th>
                  <th class="text-left">REQUIRED INSTAGRAM HANDLES</th>
                </tr>
              </thead>
              <tbody>
                ${deliverables.map(d => {
                  const isReel = String(d.type || '').toLowerCase().includes('reel');
                  const isDemo = String(d.type || '').toLowerCase().includes('demonstration');
                  const qty = isReel ? Math.max(4, Number(d.quantity || 4)) : (d.quantity || 1);
                  const handles = (isReel || isDemo)
                    ? '@nextora_pos, @nextora_creations'
                    : (d.required_tags || '@nextora_pos, @nextora_creations');
                  return `
                    <tr>
                      <td class="font-medium">${esc(d.type)}</td>
                      <td class="text-center font-mono font-bold">${qty}</td>
                      <td>${esc(d.frequency || 'Monthly')}</td>
                      <td class="font-mono text-primary font-medium">${esc(handles)}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p class="nc-intro-p italic">Marketing deliverables shall be agreed upon mutually in writing via campaign schedules.</p>`}
      </section>
    </div>

    <!-- Page 1 Running Footer -->
    <footer class="nc-running-footer">
      <div class="nc-footer-meta">Nextora Creations · ${esc(s.product_name || 'Nextora POS')} Influencer Partnership Agreement · ${esc(s.contract_number)}</div>
      <div class="nc-footer-page">Page 1 of 3</div>
    </footer>
  </div>

  <!-- ==================== PAGE 2: SECTIONS 4, 5, 6 ==================== -->
  <div class="nc-a4-page" data-page="2">
    <div class="nc-page-content">
      <div class="nc-top-stripe"></div>

      <!-- Page 2 Running Header -->
      <header class="nc-running-header">
        <div class="nc-running-title">INFLUENCER MARKETING &amp; REVENUE-SHARING AGREEMENT</div>
        <div class="nc-running-contract font-mono">Contract: ${esc(s.contract_number)}</div>
      </header>
      <div class="nc-running-divider"></div>

      <!-- SECTION 4: REVENUE-SHARING TERMS & CALCULATION BASIS -->
      <section class="nc-section">
        <div class="nc-section-heading">
          <span class="nc-heading-accent"></span>
          <h3 class="nc-heading-text">SECTION 4: REVENUE-SHARING TERMS &amp; CALCULATION BASIS</h3>
        </div>
        <div class="nc-clauses-body">
          ${String(clauses.section_4_revenue_terms || '')
            .split('\n\n')
            .map(p => p.trim() ? `<p class="nc-clause-p">${esc(p)}</p>` : '')
            .join('')}
        </div>

        <!-- Section 4 Illustrative Calculation Box -->
        <div class="nc-calc-box">
          <h4 class="nc-calc-title">ILLUSTRATIVE CALCULATION EXAMPLE (NON-BINDING)</h4>
          <div class="nc-table-wrap mb-3">
            <table class="nc-data-table nc-calc-table">
              <thead>
                <tr>
                  <th class="text-left">PRODUCT</th>
                  <th class="text-right">PRICE (INCL. GST)</th>
                  <th class="text-center">GST RATE</th>
                  <th class="text-right">GST AMOUNT</th>
                  <th class="text-right">NET VALUE (EX. GST)</th>
                  <th class="text-center">COMM. %</th>
                  <th class="text-right">INFLUENCER COMM.</th>
                </tr>
              </thead>
              <tbody>
                ${products.map(p => `
                  <tr>
                    <td class="font-medium">${esc(p.name)}</td>
                    <td class="text-right font-mono">${formatMinor(p.gross_sale_minor)}</td>
                    <td class="text-center font-mono">${esc(p.gst_rate_percent)}</td>
                    <td class="text-right font-mono">${formatMinor(p.gst_amount_minor)}</td>
                    <td class="text-right font-mono font-medium">${formatMinor(p.net_sale_minor)}</td>
                    <td class="text-center font-mono text-primary">${esc(p.commission_rate_percent)}</td>
                    <td class="text-right font-mono font-bold text-accent">${formatMinor(p.commission_minor)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- GST Classification Cards -->
          <div class="nc-gst-grid mb-3">
            <div class="nc-gst-card">
              <p class="nc-gst-card-title text-primary">Eligible Telangana Intra-State Supplies (CGST 9% + SGST 9%):</p>
              <div class="nc-gst-card-body">
                <div>• <span class="font-medium">Mobile App:</span> CGST ₹457.55 + SGST ₹457.55 = Total GST ₹915.10</div>
                <div>• <span class="font-medium">Desktop:</span> CGST ₹610.10 + SGST ₹610.09 = Total GST ₹1,220.19</div>
              </div>
            </div>
            <div class="nc-gst-card">
              <p class="nc-gst-card-title text-primary">Eligible Interstate Supplies (IGST 18%):</p>
              <div class="nc-gst-card-body">
                <div>• <span class="font-medium">Mobile App:</span> IGST ₹915.10 (18%)</div>
                <div>• <span class="font-medium">Desktop:</span> IGST ₹1,220.19 (18%)</div>
                <div class="italic mt-1 text-slate-500">— Commission calculated on Net Sale Value excluding GST.</div>
              </div>
            </div>
          </div>

          <p class="nc-calc-disclaimer">
            ${esc(calc.products_disclaimer || calc.disclaimer || 'Illustrative calculation based on the listed retail prices and the stated GST rate. Actual commission is calculated on verified eligible sales under this agreement, subject to applicable cancellations, refunds, chargebacks, and other agreed adjustments.')}
          </p>
        </div>
      </section>

      <!-- SECTION 5: MARKETING OBLIGATIONS AND PROFESSIONAL CONDUCT -->
      <section class="nc-section">
        <div class="nc-section-heading">
          <span class="nc-heading-accent"></span>
          <h3 class="nc-heading-text">SECTION 5: MARKETING OBLIGATIONS AND PROFESSIONAL CONDUCT</h3>
        </div>
        <div class="nc-clauses-body">
          ${String(clauses.section_5_conduct_obligations || '')
            .split('\n\n')
            .map(p => p.trim() ? `<p class="nc-clause-p">${esc(p)}</p>` : '')
            .join('')}
        </div>

        <!-- Visually Prominent Highlighted Mandatory Tracking Container -->
        <div class="nc-tracking-callout">
          <div class="nc-callout-header">
            <h4 class="nc-callout-title">IMPORTANT — MANDATORY INFLUENCER CONTACT NUMBER &amp; CUSTOMER TRACKING</h4>
          </div>
          <div class="nc-callout-body">
            <p class="nc-callout-p"><strong>Mandatory Requirement:</strong> The Influencer shall provide an active mobile contact number to Nextora Creations for official reference, customer coordination, and customer acquisition tracking purposes.</p>
            <p class="nc-callout-p">Nextora Creations will use the provided contact number as one of the reference points to identify, record, and track customers acquired through each Influencer's promotional activities. This will help the company measure influencer performance, maintain accurate customer attribution records, and calculate eligible commissions under the revenue-sharing terms of this Agreement.</p>
            <p class="nc-callout-p">The Influencer shall cooperate with Nextora Creations in identifying and managing referred customers and ensuring that relevant customer enquiries and referrals are properly recorded.</p>
            <p class="nc-callout-p">Nextora Creations shall be responsible for software/application installation and setup, agreed promotional content creation, and technical assistance. The Influencer shall be responsible for customer communication and coordination as mutually agreed.</p>
            <p class="nc-callout-p">Providing the contact number is a <strong>mandatory condition of participation</strong> in the influencer partnership program. The contact number shall be used for the purposes stated above and handled in accordance with applicable privacy requirements.</p>
            <p class="nc-callout-p"><strong>Customer Attribution:</strong> Providing a contact number alone does not automatically qualify a customer for commission. Commission eligibility shall be determined using verified referral codes, tracking links, customer records, or other approved attribution methods specified in the revenue-sharing terms of this Agreement.</p>
          </div>
        </div>
      </section>
    </div>

    <!-- Page 2 Running Footer -->
    <footer class="nc-running-footer">
      <div class="nc-footer-meta">Nextora Creations · ${esc(s.product_name || 'Nextora POS')} Influencer Partnership Agreement · ${esc(s.contract_number)}</div>
      <div class="nc-footer-page">Page 2 of 3</div>
    </footer>
  </div>

  <!-- ==================== PAGE 3: SECTIONS 6, 7, 8, 9, 10 ==================== -->
  <div class="nc-a4-page" data-page="3">
    <div class="nc-page-content">
      <div class="nc-top-stripe"></div>

      <!-- Page 3 Running Header -->
      <header class="nc-running-header">
        <div class="nc-running-title">INFLUENCER MARKETING &amp; REVENUE-SHARING AGREEMENT</div>
        <div class="nc-running-contract font-mono">Contract: ${esc(s.contract_number)}</div>
      </header>
      <div class="nc-running-divider"></div>

      <!-- SECTION 6: BRAND ASSETS AND INTELLECTUAL PROPERTY -->
      <section class="nc-section">
        <div class="nc-section-heading">
          <span class="nc-heading-accent"></span>
          <h3 class="nc-heading-text">SECTION 6: BRAND ASSETS AND INTELLECTUAL PROPERTY</h3>
        </div>
        <div class="nc-clauses-body">
          ${String(clauses.section_6_brand_intellectual_property || '')
            .split('\n\n')
            .map(p => p.trim() ? `<p class="nc-clause-p">${esc(p)}</p>` : '')
            .join('')}
        </div>
      </section>

      <!-- SECTION 7: PAYMENT SCHEDULE, INVOICING & TAXES -->
      <section class="nc-section">
        <div class="nc-section-heading">
          <span class="nc-heading-accent"></span>
          <h3 class="nc-heading-text">SECTION 7: PAYMENT SCHEDULE, INVOICING &amp; TAXES</h3>
        </div>
        <div class="nc-clauses-body">
          ${String(clauses.section_7_payment_invoicing || '')
            .split('\n\n')
            .map(p => p.trim() ? `<p class="nc-clause-p">${esc(p)}</p>` : '')
            .join('')}
        </div>
      </section>

      <!-- SECTION 8: TERM, TERMINATION & POST-TERMINATION RIGHTS -->
      <section class="nc-section">
        <div class="nc-section-heading">
          <span class="nc-heading-accent"></span>
          <h3 class="nc-heading-text">SECTION 8: TERM, TERMINATION &amp; POST-TERMINATION RIGHTS</h3>
        </div>
        <div class="nc-clauses-body">
          ${String(clauses.section_8_term_termination || '')
            .split('\n\n')
            .map(p => p.trim() ? `<p class="nc-clause-p">${esc(p)}</p>` : '')
            .join('')}
        </div>
      </section>

      <!-- SECTION 9: GENERAL LEGAL PROVISIONS -->
      <section class="nc-section">
        <div class="nc-section-heading">
          <span class="nc-heading-accent"></span>
          <h3 class="nc-heading-text">SECTION 9: GENERAL LEGAL PROVISIONS</h3>
        </div>
        <div class="nc-clauses-body">
          ${String(clauses.section_9_general_legal || '')
            .split('\n\n')
            .map(p => p.trim() ? `<p class="nc-clause-p">${esc(p)}</p>` : '')
            .join('')}
        </div>
      </section>

      ${s.special_terms ? `
        <section class="nc-section">
          <div class="nc-section-heading">
            <span class="nc-heading-accent"></span>
            <h3 class="nc-heading-text">SECTION 9A: SPECIAL AGREED TERMS &amp; CONDITIONS</h3>
          </div>
          <div class="nc-clauses-body">
            <p class="nc-clause-p">${esc(s.special_terms)}</p>
          </div>
        </section>
      ` : ''}

      <!-- SECTION 10: ACCEPTANCE & EXECUTION -->
      <section class="nc-section nc-signatures-section">
        <div class="nc-section-heading">
          <span class="nc-heading-accent"></span>
          <h3 class="nc-heading-text">SECTION 10: ACCEPTANCE &amp; EXECUTION</h3>
        </div>
        <p class="nc-exec-intro">IN WITNESS WHEREOF, the parties hereto have caused this Agreement to be duly executed by their authorized representatives as of the dates set forth below:</p>

        <div class="nc-signatures-grid">
          <div class="nc-sig-box">
            <div class="nc-sig-header">FOR NEXTORA CREATIONS:</div>
            <div class="nc-sig-line"></div>
            <div class="nc-sig-label">Authorized Signature</div>
            <div class="nc-sig-name">Name: <span class="font-bold">${esc(b.signatory_name || 'Gorke Sai Kumar')}</span></div>
            <div class="nc-sig-meta">Designation: ${esc(b.signatory_title || 'Founder & CEO')}</div>
            <div class="nc-sig-date">Date: ________________________</div>
          </div>
          <div class="nc-sig-box">
            <div class="nc-sig-header">FOR INFLUENCER / MARKETING PARTNER:</div>
            <div class="nc-sig-line"></div>
            <div class="nc-sig-label">Influencer Signature</div>
            <div class="nc-sig-name">Name: <span class="font-bold">${esc(inf.legal_name || '—')}</span></div>
            <div class="nc-sig-meta">Instagram: ${esc(inf.instagram_username || '—')}</div>
            <div class="nc-sig-date">Date: ________________________</div>
          </div>
        </div>

        <p class="nc-legal-note">
          Note: Generating or downloading this PDF document does not constitute formal execution or proof of signature. Both parties must execute this Agreement via verified electronic signature or ink signature before the partnership becomes active.
        </p>
      </section>
    </div>

    <!-- Page 3 Running Footer -->
    <footer class="nc-running-footer">
      <div class="nc-footer-meta">Nextora Creations · ${esc(s.product_name || 'Nextora POS')} Influencer Partnership Agreement · ${esc(s.contract_number)}</div>
      <div class="nc-footer-page">Page 3 of 3</div>
    </footer>
  </div>
</div>
  `.trim();

  const styles = `
<style>
  /* ==================== CANONICAL A4 PAGINATED DOCUMENT STYLES ==================== */
  .nc-influencer-doc {
    font-family: "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 11px;
    line-height: 1.5;
    color: #0f172a;
    background: #f1f5f9;
    padding: 24px 0;
  }

  /* A4 Page Sheets */
  .nc-a4-page {
    width: 210mm;
    min-height: 297mm;
    max-width: 100%;
    margin: 0 auto 28px auto;
    padding: 36px 40px;
    box-sizing: border-box;
    background: #ffffff;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.08);
    border: 1px solid #e2e8f0;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .nc-page-content {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .nc-top-stripe {
    height: 3.5px;
    background: ${accentColor};
    margin: -36px -40px 24px -40px;
  }

  /* Running Header on Pages 2 & 3 */
  .nc-running-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 9.5px;
    color: #64748b;
    margin-bottom: 6px;
  }
  .nc-running-title {
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .nc-running-contract {
    font-weight: 600;
  }
  .nc-running-divider {
    border-bottom: 0.5px solid #e2e8f0;
    margin-bottom: 20px;
  }

  /* Running Footer */
  .nc-running-footer {
    border-top: 0.5px solid #e2e8f0;
    padding-top: 10px;
    margin-top: 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 9px;
    color: #64748b;
  }
  .nc-footer-meta {
    font-weight: 500;
  }
  .nc-footer-page {
    font-weight: 700;
    color: #0f172a;
  }

  /* Typography utilities */
  .nc-influencer-doc .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .nc-influencer-doc .font-bold { font-weight: 700; }
  .nc-influencer-doc .font-medium { font-weight: 500; }
  .nc-influencer-doc .text-primary { color: ${accentColor}; }
  .nc-influencer-doc .text-accent { color: #0284c7; }
  .nc-influencer-doc .text-left { text-align: left; }
  .nc-influencer-doc .text-center { text-align: center; }
  .nc-influencer-doc .text-right { text-align: right; }
  .nc-influencer-doc .italic { font-style: italic; }
  .nc-influencer-doc .mb-3 { margin-bottom: 12px; }

  /* Document Header */
  .nc-contract-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
    padding-bottom: 14px;
  }
  .nc-header-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    flex: 1;
  }
  .nc-company-logo-wrap {
    margin-bottom: 4px;
  }
  .nc-company-logo {
    max-height: 48px;
    max-width: 140px;
    object-fit: contain;
    display: block;
  }
  .nc-business-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nc-business-title {
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: ${accentColor};
    margin: 0;
    text-transform: uppercase;
  }
  .nc-business-legal {
    font-size: 10px;
    color: #64748b;
    margin: 0;
  }
  .nc-business-address {
    font-size: 10px;
    color: #64748b;
    margin: 2px 0 0 0;
  }
  .nc-business-contacts {
    font-size: 9.5px;
    color: #64748b;
    margin: 0;
  }
  .nc-business-contacts a {
    color: #0284c7;
    text-decoration: none;
  }
  .nc-business-tax {
    font-size: 9.5px;
    color: #64748b;
    margin: 2px 0 0 0;
  }

  .nc-header-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
    flex-shrink: 0;
  }
  .nc-product-logo-wrap {
    margin-bottom: 6px;
  }
  .nc-product-logo {
    max-height: 48px;
    max-width: 140px;
    object-fit: contain;
    display: block;
  }
  .nc-product-title {
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
  }
  .nc-product-sub {
    font-size: 9.5px;
    color: #64748b;
    margin-bottom: 6px;
  }
  .nc-header-contract-pill {
    display: inline-block;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    padding: 3px 10px;
    font-size: 10px;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: 0.04em;
    margin-top: 4px;
  }

  .nc-header-divider {
    border-bottom: 1px solid #e2e8f0;
    margin-bottom: 18px;
  }

  /* Title Banner */
  .nc-title-banner {
    background: #f8fafc;
    padding: 10px 14px;
    margin-bottom: 18px;
    border-radius: 2px;
  }
  .nc-doc-title {
    font-size: 13.5px;
    font-weight: 800;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: #0f172a;
    margin: 0 0 3px 0;
  }
  .nc-doc-subtitle {
    font-size: 10px;
    color: #64748b;
    margin: 0;
  }

  /* 4-Column Metadata Grid */
  .nc-meta-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border: 1px solid #e2e8f0;
    background: #ffffff;
    margin-bottom: 20px;
  }
  .nc-meta-col {
    padding: 10px 12px;
    border-right: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .nc-meta-col:last-child {
    border-right: none;
  }
  .nc-meta-label {
    font-size: 8.5px;
    font-weight: 700;
    color: #64748b;
    letter-spacing: 0.06em;
  }
  .nc-meta-val {
    font-size: 11.5px;
    color: #0f172a;
    font-weight: 600;
  }
  .nc-meta-sub {
    font-size: 9.5px;
    color: #64748b;
  }

  /* Sections */
  .nc-section {
    margin-bottom: 18px;
  }
  .nc-section-heading {
    display: flex;
    align-items: center;
    background: #f8fafc;
    border-left: 3.5px solid ${accentColor};
    padding: 5px 10px;
    margin-bottom: 10px;
  }
  .nc-heading-text {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #0f172a;
    margin: 0;
  }
  .nc-intro-p {
    font-size: 10px;
    color: #334155;
    margin: 0 0 8px 0;
  }
  .nc-clauses-body {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .nc-clause-p {
    font-size: 10px;
    line-height: 1.5;
    color: #334155;
    margin: 0;
    text-align: justify;
  }

  /* Highlighted Callout for Mandatory Contact & Tracking */
  .nc-tracking-callout {
    margin-top: 10px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-left: 3.5px solid ${accentColor};
    padding: 9px 12px;
    border-radius: 2px;
  }
  .nc-callout-header {
    display: flex;
    align-items: center;
    margin-bottom: 5px;
  }
  .nc-callout-title {
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: #0f172a;
    margin: 0;
    text-transform: uppercase;
  }
  .nc-callout-body {
    display: flex;
    flex-direction: column;
    gap: 4.5px;
  }
  .nc-callout-p {
    font-size: 8.5px;
    line-height: 1.45;
    color: #1e293b;
    margin: 0;
    text-align: justify;
  }
  .nc-callout-p strong {
    font-weight: 700;
    color: #0f172a;
  }

  /* Parties Grid */
  .nc-parties-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .nc-party-card {
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .nc-party-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #64748b;
  }
  .nc-party-name {
    font-size: 11.5px;
    font-weight: 700;
    color: #0f172a;
    margin-top: 1px;
  }
  .nc-party-sub {
    font-size: 9.5px;
    color: #64748b;
  }
  .nc-party-line {
    font-size: 9.5px;
    color: #64748b;
  }
  .nc-party-contact {
    font-size: 9.5px;
    color: #64748b;
  }
  .nc-party-meta {
    font-size: 9px;
    color: #64748b;
    margin-top: 2px;
  }

  /* Deliverables & Data Tables */
  .nc-table-wrap {
    border: 1px solid #e2e8f0;
    overflow-x: auto;
  }
  .nc-data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  .nc-data-table thead th {
    background: #f1f5f9;
    border-bottom: 1px solid #cbd5e1;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #475569;
    padding: 6px 10px;
  }
  .nc-data-table tbody td {
    padding: 6px 10px;
    border-bottom: 1px solid #f1f5f9;
    color: #0f172a;
  }
  .nc-data-table tbody tr:last-child td {
    border-bottom: none;
  }

  /* Section 4 Calculation Box */
  .nc-calc-box {
    margin-top: 14px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    padding: 12px 14px;
  }
  .nc-calc-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #0f172a;
    margin: 0 0 8px 0;
  }
  .nc-calc-table thead th {
    font-size: 8.5px;
    padding: 5px 8px;
  }
  .nc-calc-table tbody td {
    font-size: 9.5px;
    padding: 5px 8px;
  }
  .nc-gst-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .nc-gst-card {
    border: 1px solid #e2e8f0;
    background: #ffffff;
    padding: 8px 10px;
  }
  .nc-gst-card-title {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.03em;
    margin: 0 0 5px 0;
  }
  .nc-gst-card-body {
    font-size: 9.5px;
    color: #475569;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .nc-calc-disclaimer {
    font-size: 8.5px;
    color: #64748b;
    font-style: italic;
    border-top: 1px solid #e2e8f0;
    padding-top: 6px;
    margin: 0;
    line-height: 1.4;
  }

  /* Section 10 Signatures */
  .nc-signatures-section {
    margin-top: 18px;
  }
  .nc-exec-intro {
    font-size: 10px;
    color: #0f172a;
    margin: 0 0 10px 0;
  }
  .nc-signatures-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 12px;
  }
  .nc-sig-box {
    border: 0.5px solid #cbd5e1;
    background: #ffffff;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
  }
  .nc-sig-header {
    font-size: 9px;
    font-weight: 700;
    color: #64748b;
    margin-bottom: 24px;
    letter-spacing: 0.04em;
  }
  .nc-sig-line {
    border-bottom: 0.5px solid #64748b;
    margin-bottom: 6px;
  }
  .nc-sig-label {
    font-size: 8.5px;
    color: #64748b;
    margin-bottom: 6px;
  }
  .nc-sig-name {
    font-size: 10px;
    color: #0f172a;
    margin-bottom: 3px;
  }
  .nc-sig-meta {
    font-size: 9.5px;
    color: #64748b;
    margin-bottom: 8px;
  }
  .nc-sig-date {
    font-size: 9.5px;
    color: #64748b;
  }
  .nc-legal-note {
    font-size: 8px;
    color: #64748b;
    line-height: 1.4;
    margin: 0;
    text-align: center;
  }

  /* Print Media Specifics */
  @page {
    size: A4 portrait;
    margin: 0;
  }
  @media print {
    body {
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
    }
    .nc-influencer-doc {
      padding: 0 !important;
      background: #ffffff !important;
    }
    .nc-a4-page {
      margin: 0 !important;
      border: none !important;
      box-shadow: none !important;
      width: 100% !important;
      min-height: 100vh !important;
      padding: 12mm 14mm !important;
      page-break-after: always !important;
      break-after: page !important;
    }
    .nc-a4-page:last-child {
      page-break-after: avoid !important;
      break-after: avoid !important;
    }
  }
</style>
  `.trim();

  if (standalone) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(s.contract_number)} — Influencer Agreement</title>
  ${styles}
</head>
<body>
  ${bodyContent}
</body>
</html>`;
  }

  return `${styles}\n${bodyContent}`;
}
