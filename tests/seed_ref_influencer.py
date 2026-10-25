import sqlite3
import json

def seed():
    con = sqlite3.connect('data/nextora.sqlite')
    cur = con.cursor()
    
    # 1. Influencer
    cur.execute('SELECT id FROM inv_influencers WHERE instagram_username = ?', ('@nizamabad_pilla__19',))
    row = cur.fetchone()
    if not row:
        cur.execute('''
            INSERT INTO inv_influencers (
                id, legal_name, display_name, instagram_username, instagram_url,
                email, phone, address, city, state_code, postal_code, country,
                status, internal_notes, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ''', (
            'b03a950a-4286-4f41-a189-60195e330002',
            'Ramya Madhuri',
            'Nizamabad_pilla',
            '@nizamabad_pilla__19',
            'https://instagram.com/nizamabad_pilla__19',
            '',
            '',
            'Yellammagutta, Nizamabad',
            'Nizamabad',
            '36',
            '503001',
            'India',
            'ACTIVE',
            'Reference influencer partner',
            '41c2bedb-6698-4de9-8f0b-e6ce9c8b8ddc'
        ))
        print('Inserted Ramya Madhuri')
    else:
        print('Ramya Madhuri already exists')

    # 2. Agreement
    cur.execute('SELECT id FROM inv_influencer_agreements WHERE contract_number = ?', ('NC/INF/2026-27/0003',))
    row2 = cur.fetchone()
    deliverables = json.dumps([{
        "type": "Instagram Reels",
        "quantity": 4,
        "frequency": "Monthly",
        "required_tags": "@nextora_pos, @nextora_creations"
    }])

    if not row2:
        cur.execute('''
            INSERT INTO inv_influencer_agreements (
                id, contract_number, influencer_id, title, brand_name, product_name, version, status,
                branding_mode, commission_basis_points, commission_basis, custom_basis_description,
                product_tax_mode, commission_tax_terms, influencer_gst_registered, influencer_gstin,
                withholding_tax_rate_bp, withholding_section, start_date, end_date, is_indefinite,
                payment_frequency, payment_due_days, minimum_payout_minor, deliverables, custom_clauses,
                special_terms, signatory_name, signatory_title, influencer_signatory_name, created_by,
                created_at, updated_at
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                datetime('now'), datetime('now')
            )
        ''', (
            'c03a950a-4286-4f41-a189-60195e330003',
            'NC/INF/2026-27/0003',
            'b03a950a-4286-4f41-a189-60195e330002',
            'Influencer Marketing & Revenue-Sharing Agreement — Nextora POS',
            'Nextora Creations',
            'Nextora POS',
            1,
            'DRAFT',
            'BOTH',
            5000,
            'NET_SALES_EX_GST',
            '',
            'INCLUSIVE',
            'EXCLUSIVE',
            0,
            '',
            0,
            '194H',
            '2026-10-25',
            '2027-10-25',
            0,
            'MONTHLY',
            7,
            100000,
            deliverables,
            '{}',
            '',
            'Gorke Sai Kumar',
            'Founder & CEO',
            'Ramya Madhuri',
            '41c2bedb-6698-4de9-8f0b-e6ce9c8b8ddc'
        ))
        print('Inserted NC/INF/2026-27/0003')
    else:
        print('NC/INF/2026-27/0003 already exists')

    con.commit()
    con.close()

if __name__ == '__main__':
    seed()
