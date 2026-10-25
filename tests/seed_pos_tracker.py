import sqlite3
import uuid
import datetime
import re

DB_PATH = 'data/nextora.sqlite'

def regexp_fn(pattern, value):
    if value is None or pattern is None:
        return 0
    return 1 if re.search(pattern, str(value)) else 0

def subset_of_fn(value, allowed):
    try:
        import json
        arr = json.loads(value) if isinstance(value, str) else value
        allowed_set = set(json.loads(allowed) if isinstance(allowed, str) else allowed)
        return 1 if (isinstance(arr, list) and all(item in allowed_set for item in arr)) else 0
    except Exception:
        return 0

def seed():
    con = sqlite3.connect(DB_PATH)
    con.create_function("REGEXP", 2, regexp_fn)
    con.create_function("subset_of", 2, subset_of_fn)
    cur = con.cursor()
    
    # 1. Clear rate limits
    cur.execute("DELETE FROM inv_rate_limits")
    
    # 2. Owner user ID
    cur.execute("SELECT id FROM inv_users WHERE email = 'owner@example.test'")
    user_row = cur.fetchone()
    owner_id = user_row[0] if user_row else '41c2bedb-6698-4de9-8f0b-e6ce9c8b8ddc'

    # 3. Business Settings
    cur.execute("SELECT id FROM inv_business_settings LIMIT 1")
    bs_row = cur.fetchone()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if not bs_row:
        cur.execute("""
            INSERT INTO inv_business_settings(
                id, business_name, legal_name, gstin, pan, email, phone,
                address, state_code,
                invoice_prefix, quotation_prefix, default_payment_terms_days, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000001', 'Nextora Creations', 'Nextora Creations Pvt Ltd',
                '36AABCU9603R1ZO', 'AABCU9603R', 'accounts@nextoracreations.com', '+91 98765 00000',
                'Plot 45, Jubilee Hills, Hyderabad 500033', '36',
                'NC/INV/', 'NC/QUO/', 15, ?
            )
        """, (now_iso,))
        print("Inserted business settings")
    else:
        cur.execute("""
            UPDATE inv_business_settings SET
                business_name = 'Nextora Creations',
                legal_name = 'Nextora Creations Pvt Ltd',
                gstin = '36AABCU9603R1ZO',
                state_code = '36',
                invoice_prefix = 'NC/INV/'
            WHERE id = ?
        """, (bs_row[0],))
        print("Updated business settings")

    # 4. Employees
    cur.execute("SELECT id FROM inv_pos_employees WHERE name = 'Ramesh Sharma'")
    if not cur.fetchone():
        emp_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO inv_pos_employees(id, name, email, status, created_at, created_by)
            VALUES (?, 'Ramesh Sharma', 'ramesh@nextora.test', 'ACTIVE', ?, ?)
        """, (emp_id, now_iso, owner_id))
        print("Inserted employee Ramesh Sharma")

    # 5. Subscription Plans
    cur.execute("SELECT id FROM inv_pos_subscription_plans WHERE label = '1 Year Plan'")
    if not cur.fetchone():
        plan_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO inv_pos_subscription_plans(id, label, duration_months, is_lifetime, status, position, created_at, created_by)
            VALUES (?, '1 Year Plan', 12, 0, 'ACTIVE', 1, ?, ?)
        """, (plan_id, now_iso, owner_id))
        print("Inserted 1 Year Plan")

    cur.execute("SELECT id FROM inv_pos_subscription_plans WHERE label = 'Lifetime Plan'")
    if not cur.fetchone():
        plan_life_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO inv_pos_subscription_plans(id, label, duration_months, is_lifetime, status, position, created_at, created_by)
            VALUES (?, 'Lifetime Plan', 0, 1, 'ACTIVE', 2, ?, ?)
        """, (plan_life_id, now_iso, owner_id))
        print("Inserted Lifetime Plan")

    # 6. Products
    cur.execute("SELECT id FROM inv_products WHERE name = 'Nextora POS Desktop'")
    if not cur.fetchone():
        prod_desk_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO inv_products(
                id, name, sku, description, category, unit, unit_price_minor,
                tax_treatment, tax_rate_bp, hsn_sac, status, billing_interval,
                license_duration_months, created_by, created_at, updated_at
            ) VALUES (
                ?, 'Nextora POS Desktop', 'POS-DESK-01', 'Desktop POS licence', 'Nextora POS', 'LIC',
                2500000, 'TAXABLE', 1800, '998314', 'ACTIVE', 'YEARLY', 12, ?, ?, ?
            )
        """, (prod_desk_id, owner_id, now_iso, now_iso))
        print("Inserted Nextora POS Desktop")

    cur.execute("SELECT id FROM inv_products WHERE name = 'Nextora POS Mobile App'")
    if not cur.fetchone():
        prod_mob_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO inv_products(
                id, name, sku, description, category, unit, unit_price_minor,
                tax_treatment, tax_rate_bp, hsn_sac, status, billing_interval,
                license_duration_months, created_by, created_at, updated_at
            ) VALUES (
                ?, 'Nextora POS Mobile App', 'POS-MOB-01', 'Mobile POS licence', 'Nextora POS', 'LIC',
                1200000, 'TAXABLE', 1800, '998314', 'ACTIVE', 'YEARLY', 12, ?, ?, ?
            )
        """, (prod_mob_id, owner_id, now_iso, now_iso))
        print("Inserted Nextora POS Mobile App")

    # 7. Custom Field
    cur.execute("SELECT id FROM inv_custom_field_definitions WHERE label = 'Tax Slab Category'")
    if not cur.fetchone():
        field_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO inv_custom_field_definitions(
                id, entity, label, field_type, description, required, visible, width,
                position, editor_roles, status, created_at, updated_at, created_by
            ) VALUES (
                ?, 'POS_CUSTOMER', 'Tax Slab Category', 'TEXT', 'Category for tax slabs', 0, 1, 160,
                1, '["OWNER", "ADMIN"]', 'ACTIVE', ?, ?, ?
            )
        """, (field_id, now_iso, now_iso, owner_id))
        print("Inserted Tax Slab Category custom field")

    con.commit()
    con.close()
    print("Seed complete.")

if __name__ == '__main__':
    seed()
