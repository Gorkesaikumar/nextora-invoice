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

export function renderSoftwareContractHtml(snapshot, { logoDataUri = null, standalone = false } = {}) {
  const s = snapshot;
  const b = s.business || {};
  const c = s.client || {};
  const p = s.project || {};
  const fin = s.financials || {};
  const scope = s.scope || {};
  const features = scope.features || [];
  const sup = s.support_and_maintenance || {};
  const clauses = s.clauses || {};
  const milestones = s.milestones?.payment_milestones || [];
  const accentColor = b.pdf_accent_color || '#00AEEF';

  const bodyContent = `
<div class="nc-contract-doc">
  <!-- ==================== HEADER (PHASE 3) ==================== -->
  <header class="nc-contract-header">
    <div class="nc-header-top">
      ${logoDataUri ? `
        <div class="nc-logo-wrap">
          <img src="${esc(logoDataUri)}" alt="${esc(b.business_name || 'Nextora Creations')}" class="nc-logo-img">
        </div>
      ` : `
        <div class="nc-logo-fallback">
          <span class="nc-logo-fallback-text">${esc(b.business_name || 'NEXTORA CREATIONS')}</span>
        </div>
      `}
    </div>

    <div class="nc-header-middle">
      <h1 class="nc-company-title">${esc(b.business_name || 'NEXTORA CREATIONS')}</h1>
      ${b.legal_name && b.legal_name !== b.business_name ? `<p class="nc-company-legal">${esc(b.legal_name)}</p>` : ''}
      <p class="nc-company-address">${esc(b.address || 'Hyderabad, Telangana, India')}</p>
      <p class="nc-company-contact">
        ${[
          b.phone ? `Phone: ${esc(b.phone)}` : null,
          b.website ? `Web: <a href="${esc(b.website)}" target="_blank" rel="noopener">${esc(b.website)}</a>` : null,
          b.email ? `Email: ${esc(b.email)}` : null,
        ].filter(Boolean).join(' &nbsp;·&nbsp; ')}
      </p>
      <p class="nc-company-tax">
        <strong>GSTIN:</strong> ${esc(b.gstin || '36JTAPK9167A1ZK')} &nbsp;·&nbsp; <strong>State:</strong> Telangana (${esc(b.state_code || '36')})
      </p>
    </div>

    <div class="nc-header-supporting">
      <div class="nc-header-meta-pill">
        <span class="nc-meta-label">CONTRACT NUMBER:</span>
        <span class="nc-meta-value font-mono">${esc(s.contract_number)}</span>
      </div>
      <div class="nc-header-meta-pill">
        <span class="nc-meta-label">DATE:</span>
        <span class="nc-meta-value">${formatDate(p.start_date || s.created_at)}</span>
      </div>
      <div class="nc-header-meta-pill">
        <span class="nc-meta-label">STATUS:</span>
        <span class="nc-meta-status ${esc(s.status?.toLowerCase())}">${esc(s.status)}</span>
      </div>
      <div class="nc-header-meta-pill">
        <span class="nc-meta-label">CATEGORY:</span>
        <span class="nc-meta-value">${esc(s.service_category)}</span>
      </div>
    </div>

    <div class="nc-header-divider"></div>
  </header>

  <!-- ==================== CONTRACT TITLE BANNER ==================== -->
  <div class="nc-title-banner">
    <h2 class="nc-title-main">SOFTWARE DEVELOPMENT SERVICES AGREEMENT</h2>
    <p class="nc-title-sub">
      Service Category: <span class="font-semibold">${esc(s.service_category)}</span> &nbsp;·&nbsp; 
      Engagement Title: <span class="font-semibold">${esc(s.title)}</span>
    </p>
  </div>

  <!-- ==================== METADATA 4-COLUMN SUMMARY BOX ==================== -->
  <div class="nc-meta-box nc-avoid-break">
    <div class="nc-meta-col">
      <span class="nc-box-label">PROJECT TITLE</span>
      <span class="nc-box-val" title="${esc(s.title)}">${esc(s.title)}</span>
    </div>
    <div class="nc-meta-col">
      <span class="nc-box-label">ESTIMATED TIMELINE</span>
      <span class="nc-box-val">${esc(p.development_duration || '1 Month')}</span>
    </div>
    <div class="nc-meta-col">
      <span class="nc-box-label">FREE SUPPORT</span>
      <span class="nc-box-val">${esc(sup.free_support_months ?? 3)} Months Included</span>
    </div>
    <div class="nc-meta-col">
      <span class="nc-box-label">CONTRACT STATUS</span>
      <span class="nc-box-val font-semibold">${esc(s.status)}</span>
    </div>
  </div>

  <!-- ==================== SECTION 1: PARTIES ==================== -->
  <section class="nc-section nc-avoid-break">
    <div class="nc-section-heading">
      <span class="nc-heading-accent"></span>
      <h3>SECTION 1: PARTIES TO THE AGREEMENT</h3>
    </div>
    <div class="nc-section-body">
      <p class="nc-clause-intro">${esc(clauses.section_1_parties || '')}</p>
      
      <div class="nc-two-col-cards">
        <div class="nc-party-card">
          <div class="nc-party-badge">DEVELOPER / SERVICE PROVIDER</div>
          <p class="nc-party-name">${esc(b.business_name || 'Nextora Creations')}</p>
          <p class="nc-party-detail">${esc(b.address || 'Hyderabad, Telangana, India')}</p>
          <p class="nc-party-detail">Phone: ${esc(b.phone || '7674981970')} &nbsp;·&nbsp; Web: ${esc(b.website || 'https://nextoracreations.co.in/')}</p>
          <p class="nc-party-tax">GSTIN: ${esc(b.gstin || '36JTAPK9167A1ZK')} &nbsp;·&nbsp; State: Telangana (${esc(b.state_code || '36')})</p>
          <p class="nc-party-signatory">Signatory: ${esc(b.signatory_name || 'Authorized Signatory')} (${esc(b.signatory_title || 'Managing Partner')})</p>
        </div>

        <div class="nc-party-card">
          <div class="nc-party-badge">CLIENT / CUSTOMER</div>
          <p class="nc-party-name">${esc(c.legal_name || c.name || '—')}</p>
          <p class="nc-party-detail">${esc([c.billing_address, c.city, c.postal_code, c.country].filter(Boolean).join(', ') || 'Address on file')}</p>
          <p class="nc-party-detail">Contact: ${esc(c.contact_person || '—')} &nbsp;·&nbsp; Email: ${esc(c.email || '—')} &nbsp;·&nbsp; Phone: ${esc(c.phone || '—')}</p>
          <p class="nc-party-tax">GSTIN: ${esc(c.gstin || 'Unregistered')} &nbsp;·&nbsp; PAN: ${esc(c.pan || '—')} &nbsp;·&nbsp; State Code: ${esc(c.state_code || '36')}</p>
          <p class="nc-party-signatory">Signatory: ${esc(c.signatory_name || '—')} (${esc(c.signatory_designation || 'Authorized Representative')})</p>
        </div>
      </div>
    </div>
  </section>

  <!-- ==================== SECTION 2: PROJECT & SERVICE DETAILS ==================== -->
  <section class="nc-section nc-avoid-break">
    <div class="nc-section-heading">
      <span class="nc-heading-accent"></span>
      <h3>SECTION 2: PROJECT &amp; SERVICE DETAILS</h3>
    </div>
    <div class="nc-section-body">
      <ul class="nc-bullet-list">
        <li><strong>Service Category:</strong> ${esc(s.service_category)}</li>
        ${p.service_description ? `<li><strong>Description:</strong> ${esc(p.service_description)}</li>` : ''}
        ${p.business_objectives ? `<li><strong>Business Objectives:</strong> ${esc(p.business_objectives)}</li>` : ''}
        <li><strong>Project Start Date:</strong> ${formatDate(p.start_date)} &nbsp;·&nbsp; <strong>Estimated Completion:</strong> ${p.estimated_completion_date ? formatDate(p.estimated_completion_date) : 'Approximately 1 Month'}</li>
        ${p.deployment_target ? `<li><strong>Deployment Target:</strong> ${esc(p.deployment_target)}</li>` : ''}
        ${p.hosting_responsibility ? `<li><strong>Hosting Responsibility:</strong> ${esc(p.hosting_responsibility)}</li>` : ''}
        ${p.client_assets_access ? `<li><strong>Client-Provided Assets &amp; Access:</strong> ${esc(p.client_assets_access)}</li>` : ''}
        ${p.third_party_integrations ? `<li><strong>Third-Party Integrations:</strong> ${esc(p.third_party_integrations)}</li>` : ''}
        ${p.acceptance_criteria ? `<li><strong>Acceptance Criteria:</strong> ${esc(p.acceptance_criteria)}</li>` : ''}
      </ul>
    </div>
  </section>

  <!-- ==================== SECTION 3: REQUIREMENTS & FEATURE SCOPE ==================== -->
  <section class="nc-section">
    <div class="nc-section-heading">
      <span class="nc-heading-accent"></span>
      <h3>SECTION 3: REQUIREMENTS &amp; FEATURE SCOPE (SCHEDULE A)</h3>
    </div>
    <div class="nc-section-body">
      <p class="nc-sub-intro">The software solution includes the following agreed features, deliverables, and acceptance criteria. Features not approved in writing herein are excluded from scope.</p>

      <div class="nc-table-wrap">
        <table class="nc-data-table">
          <thead>
            <tr>
              <th style="width: 6%;">S.No</th>
              <th style="width: 22%;">Feature Name</th>
              <th style="width: 26%;">Description</th>
              <th style="width: 18%;">Deliverables</th>
              <th style="width: 9%; text-align: center;">Priority</th>
              <th style="width: 9%; text-align: center;">Scope</th>
              <th style="width: 10%;">Notes / Criteria</th>
            </tr>
          </thead>
          <tbody>
            ${features.length ? features.map((f, idx) => `
              <tr class="${idx % 2 === 1 ? 'nc-row-zebra' : ''}">
                <td style="text-align: center;" class="font-mono">${idx + 1}</td>
                <td><strong>${esc(f.name)}</strong></td>
                <td>${esc(f.description || '—')}</td>
                <td class="nc-text-muted">${esc(f.deliverables || '—')}</td>
                <td style="text-align: center;" class="nc-text-muted">${esc(f.priority || 'Normal')}</td>
                <td style="text-align: center;">
                  <span class="nc-scope-tag ${f.included !== false ? 'included' : 'excluded'}">
                    ${f.included !== false ? 'Included' : 'Excluded'}
                  </span>
                </td>
                <td class="nc-text-muted">${esc(f.acceptance_criteria || f.notes || '—')}</td>
              </tr>
            `).join('') : `
              <tr><td colspan="7" class="nc-text-center nc-text-muted" style="padding: 12px;">Features and functional specification to be confirmed prior to execution.</td></tr>
            `}
          </tbody>
        </table>
      </div>

      <div class="nc-scope-notes">
        <ul class="nc-bullet-list">
          ${scope.included_services ? `<li><strong>Included Services:</strong> ${esc(scope.included_services)}</li>` : ''}
          ${scope.excluded_services ? `<li><strong>Excluded Services:</strong> ${esc(scope.excluded_services)}</li>` : ''}
          ${scope.client_responsibilities ? `<li><strong>Client Responsibilities:</strong> ${esc(scope.client_responsibilities)}</li>` : ''}
          ${scope.third_party_dependencies ? `<li><strong>Third-Party Dependencies:</strong> ${esc(scope.third_party_dependencies)}</li>` : ''}
        </ul>
      </div>
    </div>
  </section>

  <!-- ==================== SECTION 4: PROJECT PRICING & GST CALCULATIONS ==================== -->
  <section class="nc-section nc-avoid-break">
    <div class="nc-section-heading">
      <span class="nc-heading-accent"></span>
      <h3>SECTION 4: PROJECT PRICING &amp; GST CALCULATIONS</h3>
    </div>
    <div class="nc-section-body">
      <div class="nc-pricing-card">
        <div class="nc-pricing-grid">
          <!-- Left Column -->
          <div class="nc-pricing-col">
            <div class="nc-price-line">
              <span class="nc-price-label"><strong>Pricing Mode:</strong></span>
              <span class="nc-price-val font-semibold">${fin.pricing_mode === 'INCLUSIVE' ? 'GST-Inclusive Pricing' : 'GST-Exclusive Pricing'}</span>
            </div>
            <div class="nc-price-line">
              <span class="nc-price-label">1. Project Base Price:</span>
              <span class="nc-price-val font-mono">${formatMinor(fin.base_price_minor || 0)}</span>
            </div>
            <div class="nc-price-line ${fin.discount_minor > 0 ? 'nc-discount-highlight' : 'nc-text-muted'}">
              <span class="nc-price-label">2. Discount:</span>
              <span class="nc-price-val font-mono">${fin.discount_minor > 0 ? '-' : ''}${formatMinor(fin.discount_minor || 0)}</span>
            </div>
            <div class="nc-price-line">
              <span class="nc-price-label"><strong>3. Taxable Amount:</strong></span>
              <span class="nc-price-val font-mono font-bold">${formatMinor(fin.taxable_amount_minor || 0)}</span>
            </div>
            <div class="nc-price-line nc-gst-details">
              ${fin.supply_type === 'INTRA' ? `
                <span class="nc-price-label">4. GST (${fin.gst_rate_percent || '18.00'}%):</span>
                <span class="nc-price-val font-mono">
                  CGST (${((fin.gst_rate_bp || 1800) / 200).toFixed(1)}%) = ${formatMinor(fin.cgst_minor || 0)} &nbsp;·&nbsp; 
                  SGST (${((fin.gst_rate_bp || 1800) / 200).toFixed(1)}%) = ${formatMinor(fin.sgst_minor || 0)}
                </span>
              ` : `
                <span class="nc-price-label">4. GST (${fin.gst_rate_percent || '18.00'}%):</span>
                <span class="nc-price-val font-mono">IGST (${fin.gst_rate_percent || '18.00'}%) = ${formatMinor(fin.igst_minor || 0)}</span>
              `}
            </div>
            <div class="nc-price-line nc-price-sub">
              <span class="nc-price-label"><strong>Total GST:</strong></span>
              <span class="nc-price-val font-mono font-bold">${formatMinor(fin.total_gst_minor || 0)}</span>
            </div>
          </div>

          <!-- Right Column -->
          <div class="nc-pricing-col nc-pricing-col-right">
            <div class="nc-price-line">
              <span class="nc-price-label"><strong>Tax Classification:</strong></span>
              <span class="nc-price-val font-semibold">${esc(fin.supply_type_label || (fin.supply_type === 'INTER' ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'))}</span>
            </div>
            <div class="nc-price-line nc-final-amount">
              <span class="nc-price-label"><strong>5. Final Project Amount:</strong></span>
              <span class="nc-price-val font-mono font-bold nc-text-primary">${formatMinor(fin.final_amount_minor || 0)}</span>
            </div>
            <div class="nc-price-line">
              <span class="nc-price-label">6. Advance Percentage:</span>
              <span class="nc-price-val font-mono">${fin.advance_percentage_label || '10.00%'}</span>
            </div>
            <div class="nc-price-line nc-advance-payable">
              <span class="nc-price-label"><strong>7. Advance Payable:</strong></span>
              <span class="nc-price-val font-mono font-bold nc-text-accent">${formatMinor(fin.advance_amount_minor || 0)}</span>
            </div>
            <div class="nc-price-line nc-remaining-balance">
              <span class="nc-price-label"><strong>8. Remaining Balance:</strong></span>
              <span class="nc-price-val font-mono font-bold">${formatMinor(fin.remaining_balance_minor || 0)}</span>
            </div>
            <div class="nc-price-line nc-reconciliation-status">
              <span class="nc-price-label">Balance Allocation:</span>
              <span class="nc-reconciled-badge ${fin.is_milestones_reconciled ? 'reconciled' : 'pending'}">
                ${fin.is_milestones_reconciled ? 'Fully Reconciled with Milestones' : 'Reconciliation Pending'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ==================== SECTION 5: PAYMENT TERMS & MILESTONES ==================== -->
  <section class="nc-section nc-avoid-break">
    <div class="nc-section-heading">
      <span class="nc-heading-accent"></span>
      <h3>SECTION 5: PAYMENT TERMS &amp; MILESTONES</h3>
    </div>
    <div class="nc-section-body">
      <div class="nc-table-wrap">
        <table class="nc-data-table">
          <thead>
            <tr>
              <th style="width: 8%; text-align: center;">S.No</th>
              <th style="width: 32%;">Milestone Name</th>
              <th style="width: 36%;">Trigger Event / Deliverable</th>
              <th style="width: 12%;">Due Date</th>
              <th style="width: 12%; text-align: right;">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${milestones.length ? milestones.map((m, idx) => `
              <tr class="${idx % 2 === 1 ? 'nc-row-zebra' : ''}">
                <td style="text-align: center;" class="font-mono">${idx + 1}</td>
                <td><strong>${esc(m.name || `Milestone ${idx + 1}`)}</strong></td>
                <td>${esc(m.trigger || 'Upon deliverable completion and UAT sign-off')}</td>
                <td class="nc-text-muted">${m.due_date ? formatDate(m.due_date) : 'On Acceptance'}</td>
                <td style="text-align: right;" class="font-mono font-bold">${formatMinor(m.amount_minor || 0)}</td>
              </tr>
            `).join('') : `
              <tr><td colspan="5" class="nc-text-center nc-text-muted" style="padding: 12px;">Remaining balance payable upon satisfactory delivery and deployment acceptance.</td></tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- ==================== SECTION 6: DEVELOPMENT TIMELINE ==================== -->
  <section class="nc-section nc-avoid-break">
    <div class="nc-section-heading">
      <span class="nc-heading-accent"></span>
      <h3>SECTION 6: DEVELOPMENT TIMELINE</h3>
    </div>
    <div class="nc-section-body">
      <p class="nc-narrative">
        The estimated project timeline is ${esc(p.development_duration || '1 Month')}, commencing upon execution of this Agreement, 
        receipt of the agreed 10% advance, and full delivery of client assets, credentials, and requirements sign-off. Delays in client 
        feedback or dependencies shall extend the delivery date proportionally.
      </p>
    </div>
  </section>

  <!-- ==================== SECTION 7: THREE MONTHS FREE SUPPORT & POST-SUPPORT TERMS ==================== -->
  <section class="nc-section nc-avoid-break">
    <div class="nc-section-heading">
      <span class="nc-heading-accent"></span>
      <h3>SECTION 7: THREE MONTHS FREE SUPPORT &amp; POST-SUPPORT TERMS</h3>
    </div>
    <div class="nc-section-body">
      <div class="nc-numbered-terms">
        <p><strong>1. Complimentary Support:</strong> A complimentary support period of ${esc(sup.free_support_months ?? 3)} months is provided commencing upon deployment/handover (${sup.support_start_date ? formatDate(sup.support_start_date) : 'handover date'} to ${sup.support_end_date ? formatDate(sup.support_end_date) : '3 months thereafter'}).</p>
        <p><strong>2. Support Scope:</strong> Covers correction of reproducible software defects, bugs, and minor corrective alignments to the approved specification. Strictly excludes major new features, external third-party API deprecations, and unauthorized client modifications.</p>
        <p><strong>3. Post-Support Feature Development:</strong> After the free support period expires, new feature requests shall be billed at the standard rate of ${esc(sup.post_support_feature_rate_formatted || '₹5,000.00')} per approved feature, subject to written scope confirmation and applicable GST.</p>
        <p><strong>4. Feature Request Distinction:</strong> Bug fixes restore intended functionality under approved specs. New modules, changed workflows, and additional integrations constitute paid feature enhancements.</p>
      </div>
    </div>
  </section>

  <!-- ==================== SECTION 8: MONTHLY MAINTENANCE PLAN ==================== -->
  <section class="nc-section nc-avoid-break">
    <div class="nc-section-heading">
      <span class="nc-heading-accent"></span>
      <h3>SECTION 8: MONTHLY MAINTENANCE PLAN</h3>
    </div>
    <div class="nc-section-body">
      <p class="nc-narrative ${sup.maintenance_included ? '' : 'nc-text-muted'}">
        ${sup.maintenance_included ? `
          The Client has elected ongoing application maintenance at the agreed rate of ${esc(sup.maintenance_rate_formatted || '₹2,000.00')} per month (plus applicable GST). This covers periodic application health monitoring, compatible dependency updates, and basic operational troubleshooting. It excludes new feature development, domain renewal, and cloud hosting costs. Maintenance may be cancelled by either party upon thirty (30) days written notice.
        ` : `
          Ongoing monthly maintenance is available at the standard rate of ₹2,000.00 per month (plus applicable GST) upon mutual written election. Maintenance is not automatically active and requires a separate written confirmation or maintenance addendum upon completion of the free support period.
        `}
      </p>
    </div>
  </section>

  <!-- ==================== SECTION 9: TERMS AND CONDITIONS ==================== -->
  <section class="nc-section">
    <div class="nc-section-heading">
      <span class="nc-heading-accent"></span>
      <h3>SECTION 9: TERMS AND CONDITIONS</h3>
    </div>
    <div class="nc-section-body nc-terms-grid">
      <div class="nc-term-block nc-avoid-break">
        <h4>Intellectual Property Ownership</h4>
        <p>${esc(clauses.section_11_intellectual_property || '')}</p>
      </div>

      <div class="nc-term-block nc-avoid-break">
        <h4>Confidentiality &amp; Data Protection</h4>
        <p>${esc(clauses.section_12_confidentiality || '')}</p>
      </div>

      <div class="nc-term-block nc-avoid-break">
        <h4>Third-Party Services &amp; Infrastructure</h4>
        <p>${esc(clauses.section_13_third_party_services || '')}</p>
      </div>

      <div class="nc-term-block nc-avoid-break">
        <h4>Testing, Review &amp; Acceptance</h4>
        <p>${esc(clauses.section_7_testing_acceptance || '')}</p>
      </div>

      <div class="nc-term-block nc-avoid-break">
        <h4>Change Requests &amp; Scope Modifications</h4>
        <p>${esc(clauses.section_6_change_requests || '')}</p>
      </div>

      <div class="nc-term-block nc-avoid-break">
        <h4>Suspension &amp; Termination</h4>
        <p>${esc(clauses.section_15_suspension_termination || '')}</p>
      </div>

      <div class="nc-term-block nc-avoid-break">
        <h4>Limitation of Liability</h4>
        <p>${esc(clauses.section_16_limitation_liability || '')}</p>
      </div>

      <div class="nc-term-block nc-avoid-break">
        <h4>Dispute Resolution &amp; Governing Law</h4>
        <p>${esc(clauses.section_17_dispute_resolution || '')}</p>
      </div>

      ${s.special_terms ? `
        <div class="nc-term-block nc-avoid-break">
          <h4>Special Agreed Terms &amp; Conditions</h4>
          <p>${esc(s.special_terms)}</p>
        </div>
      ` : ''}
    </div>
  </section>

  <!-- ==================== SECTION 10: ACCEPTANCE & EXECUTION ==================== -->
  <section class="nc-section nc-avoid-break">
    <div class="nc-section-heading">
      <span class="nc-heading-accent"></span>
      <h3>SECTION 10: ACCEPTANCE &amp; EXECUTION</h3>
    </div>
    <div class="nc-section-body">
      <p class="nc-narrative">${esc(clauses.section_18_signatures || 'IN WITNESS WHEREOF, the Parties hereto have caused this Agreement to be duly executed by their authorized representatives as of the date(s) set forth below:')}</p>

      <div class="nc-two-col-signatures">
        <!-- Nextora Signatory Block -->
        <div class="nc-signature-box">
          <p class="nc-sig-header">FOR NEXTORA CREATIONS:</p>
          <div class="nc-sig-line"></div>
          <p class="nc-sig-sub">Authorized Signature</p>
          <p class="nc-sig-name">Name: <strong>${esc(b.signatory_name || 'Authorized Signatory')}</strong></p>
          <p class="nc-sig-title">Designation: ${esc(b.signatory_title || 'Managing Partner')}</p>
          <p class="nc-sig-date">Date: ________________________</p>
        </div>

        <!-- Client Signatory Block -->
        <div class="nc-signature-box">
          <p class="nc-sig-header">FOR CLIENT / CUSTOMER:</p>
          <div class="nc-sig-line"></div>
          <p class="nc-sig-sub">Authorized Client Signature</p>
          <p class="nc-sig-name">Name: <strong>${esc(c.signatory_name || c.name || '—')}</strong></p>
          <p class="nc-sig-title">Designation: ${esc(c.signatory_designation || 'Authorized Representative')}</p>
          <p class="nc-sig-date">Date: ________________________</p>
        </div>
      </div>

      <p class="nc-legal-footnote">
        Note: Generating or downloading this PDF document does not constitute formal execution or proof of signature. Both parties must execute this Agreement via verified signature before software development commencement.
      </p>
    </div>
  </section>

  <!-- ==================== DOCUMENT FOOTER ==================== -->
  <footer class="nc-contract-footer">
    <div class="nc-footer-inner">
      <span>Nextora Creations &nbsp;·&nbsp; Software Development Services Agreement &nbsp;·&nbsp; ${esc(s.contract_number)}</span>
    </div>
  </footer>
</div>
`;

  const styles = `
  <style>
    /* ==================== CONTRACT CANONICAL STYLES ==================== */
    .nc-contract-doc {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.5;
      color: #0f172a;
      background: #ffffff;
      max-width: 820px;
      margin: 0 auto;
      padding: 32px 40px;
      box-sizing: border-box;
    }

    /* Print media rules */
    @page {
      size: A4 portrait;
      margin: 12mm 14mm 14mm 14mm;
    }

    @media print {
      body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }
      .nc-contract-doc {
        max-width: 100% !important;
        padding: 0 !important;
        box-shadow: none !important;
        border: none !important;
      }
      .nc-avoid-break {
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }
      .nc-section-heading {
        break-inside: avoid !important;
        break-after: avoid !important;
        page-break-after: avoid !important;
      }
      table {
        break-inside: auto;
      }
      tr {
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }
      thead {
        display: table-header-group;
      }
      .nc-contract-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
      }
    }

    /* --- Header (Phase 3) --- */
    .nc-contract-header {
      text-align: center;
      margin-bottom: 20px;
    }
    .nc-header-top {
      display: flex;
      justify-content: center;
      align-items: center;
      margin-bottom: 10px;
    }
    .nc-logo-wrap {
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .nc-logo-img {
      max-width: 140px;
      max-height: 60px;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .nc-logo-fallback {
      padding: 6px 16px;
      border: 1px dashed #cbd5e1;
      display: inline-block;
      margin-bottom: 6px;
    }
    .nc-logo-fallback-text {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: 0.05em;
    }
    .nc-company-title {
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.04em;
      color: #0f172a;
      margin: 0 0 3px 0;
      text-transform: uppercase;
    }
    .nc-company-legal {
      font-size: 11px;
      color: #64748b;
      margin: 0 0 2px 0;
    }
    .nc-company-address {
      font-size: 11px;
      color: #475569;
      margin: 0 0 2px 0;
    }
    .nc-company-contact {
      font-size: 10.5px;
      color: #475569;
      margin: 0 0 2px 0;
    }
    .nc-company-contact a {
      color: #0284c7;
      text-decoration: none;
    }
    .nc-company-tax {
      font-size: 11px;
      color: #1e293b;
      margin: 2px 0 8px 0;
    }

    .nc-header-supporting {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 12px;
      margin-top: 8px;
    }
    .nc-header-meta-pill {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 10px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .nc-meta-label {
      color: #64748b;
      font-weight: 600;
    }
    .nc-meta-value {
      color: #0f172a;
      font-weight: 700;
    }
    .nc-meta-status {
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 9.5px;
    }
    .nc-meta-status.draft { background: #fef3c7; color: #92400e; }
    .nc-meta-status.approved { background: #dcfce7; color: #166534; }
    .nc-meta-status.sent { background: #e0f2fe; color: #0369a1; }
    .nc-meta-status.signed, .nc-meta-status.active { background: #ecfdf5; color: #047857; }

    .nc-header-divider {
      height: 1px;
      background: #cbd5e1;
      width: 100%;
      margin: 14px 0 16px 0;
    }

    /* --- Title Banner --- */
    .nc-title-banner {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left: 4px solid ${accentColor};
      padding: 10px 14px;
      margin-bottom: 14px;
    }
    .nc-title-main {
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #0f172a;
      margin: 0 0 3px 0;
    }
    .nc-title-sub {
      font-size: 10.5px;
      color: #64748b;
      margin: 0;
    }

    /* --- Metadata 4-Column Box --- */
    .nc-meta-box {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      border: 1px solid #e2e8f0;
      background: #ffffff;
      margin-bottom: 20px;
    }
    .nc-meta-col {
      padding: 8px 10px;
      border-right: 1px solid #e2e8f0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .nc-meta-col:last-child {
      border-right: none;
    }
    .nc-box-label {
      font-size: 9px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .nc-box-val {
      font-size: 11px;
      font-weight: 700;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* --- Sections --- */
    .nc-section {
      margin-bottom: 18px;
    }
    .nc-section-heading {
      display: flex;
      align-items: center;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left: 3px solid ${accentColor};
      padding: 5px 10px;
      margin-bottom: 10px;
    }
    .nc-section-heading h3 {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: #0f172a;
      margin: 0;
    }
    .nc-section-body {
      padding: 0 4px;
    }
    .nc-clause-intro, .nc-sub-intro, .nc-narrative {
      font-size: 10.5px;
      line-height: 1.55;
      color: #334155;
      margin: 0 0 10px 0;
    }

    /* --- Cards Grid (Parties) --- */
    .nc-two-col-cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .nc-party-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 10px 12px;
      font-size: 10.5px;
      line-height: 1.45;
    }
    .nc-party-badge {
      font-size: 9px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }
    .nc-party-name {
      font-size: 12px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 4px 0;
    }
    .nc-party-detail {
      color: #475569;
      margin: 0 0 2px 0;
    }
    .nc-party-tax {
      color: #1e293b;
      font-weight: 600;
      margin: 4px 0 2px 0;
    }
    .nc-party-signatory {
      color: #64748b;
      font-size: 10px;
      margin: 3px 0 0 0;
    }

    /* --- Bullet Lists --- */
    .nc-bullet-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .nc-bullet-list li {
      position: relative;
      padding-left: 14px;
      margin-bottom: 4px;
      font-size: 10.5px;
      line-height: 1.45;
      color: #334155;
    }
    .nc-bullet-list li::before {
      content: "•";
      position: absolute;
      left: 2px;
      color: #64748b;
    }

    /* --- Data Tables --- */
    .nc-table-wrap {
      overflow-x: auto;
      margin-bottom: 10px;
      border: 1px solid #e2e8f0;
    }
    .nc-data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    .nc-data-table th {
      background: #f1f5f9;
      border-bottom: 1px solid #cbd5e1;
      padding: 6px 8px;
      font-weight: 700;
      text-align: left;
      color: #1e293b;
      text-transform: uppercase;
      font-size: 9.5px;
      letter-spacing: 0.02em;
    }
    .nc-data-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: top;
      line-height: 1.4;
    }
    .nc-row-zebra {
      background: #fafbfc;
    }
    .nc-scope-tag {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 700;
    }
    .nc-scope-tag.included { background: #dcfce7; color: #15803d; }
    .nc-scope-tag.excluded { background: #fee2e2; color: #b91c1c; }

    /* --- Section 4 Financial Pricing Box --- */
    .nc-pricing-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 12px 16px;
    }
    .nc-pricing-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .nc-pricing-col-right {
      border-left: 1px solid #e2e8f0;
      padding-left: 20px;
    }
    .nc-price-line {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 3px 0;
      font-size: 10.5px;
    }
    .nc-price-label {
      color: #334155;
    }
    .nc-price-val {
      color: #0f172a;
      text-align: right;
    }
    .nc-final-amount {
      border-top: 1px solid #e2e8f0;
      padding-top: 5px;
      margin-top: 2px;
    }
    .nc-advance-payable {
      border-top: 1px solid #e2e8f0;
      padding-top: 5px;
      margin-top: 2px;
    }
    .nc-remaining-balance {
      border-top: 1px solid #e2e8f0;
      padding-top: 5px;
      margin-top: 2px;
    }
    .nc-text-accent { color: ${accentColor}; }
    .nc-text-primary { color: #0284c7; }
    .nc-reconciled-badge {
      font-size: 9.5px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
    }
    .nc-reconciled-badge.reconciled { background: #dcfce7; color: #166534; }
    .nc-reconciled-badge.pending { background: #fef3c7; color: #b45309; }

    /* --- Terms & Conditions Grid --- */
    .nc-terms-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .nc-term-block h4 {
      font-size: 11px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 3px 0;
    }
    .nc-term-block p {
      font-size: 10px;
      line-height: 1.5;
      color: #334155;
      margin: 0;
      white-space: pre-line;
    }

    /* --- Numbered Support Terms --- */
    .nc-numbered-terms p {
      font-size: 10.5px;
      line-height: 1.5;
      color: #334155;
      margin: 0 0 6px 0;
    }

    /* --- Signatures (Section 10) --- */
    .nc-two-col-signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin: 14px 0 10px 0;
    }
    .nc-signature-box {
      border: 1px solid #cbd5e1;
      background: #ffffff;
      padding: 12px 14px;
      font-size: 10.5px;
    }
    .nc-sig-header {
      font-size: 10px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0 0 28px 0;
    }
    .nc-sig-line {
      height: 1px;
      background: #64748b;
      margin-bottom: 6px;
    }
    .nc-sig-sub {
      font-size: 9px;
      color: #64748b;
      margin: 0 0 8px 0;
    }
    .nc-sig-name, .nc-sig-title, .nc-sig-date {
      color: #1e293b;
      margin: 0 0 3px 0;
    }
    .nc-legal-footnote {
      font-size: 9px;
      color: #64748b;
      font-style: italic;
      line-height: 1.4;
      margin-top: 10px;
      text-align: center;
    }

    /* --- Document Footer --- */
    .nc-contract-footer {
      border-top: 1px solid #e2e8f0;
      margin-top: 24px;
      padding-top: 8px;
      font-size: 9.5px;
      color: #64748b;
      text-align: center;
    }
    .nc-footer-inner {
      display: flex;
      justify-content: center;
      align-items: center;
    }

    /* --- Typography helpers --- */
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .font-bold { font-weight: 700; }
    .font-semibold { font-weight: 600; }
    .nc-text-muted { color: #64748b; }
    .nc-text-center { text-align: center; }
  </style>
`;

  if (!standalone) {
    return `${styles}\n${bodyContent}`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Software Development Agreement — ${esc(s.contract_number)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${styles}
</head>
<body>
  ${bodyContent}
</body>
</html>`;
}
