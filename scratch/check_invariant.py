import psycopg

conn = psycopg.connect("postgresql://payledger_admin:payledger_secret_2024@localhost:5432/payledger")
cur = conn.cursor()
cur.execute("""
    SELECT transaction_id,
           SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END) AS debits,
           SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END) AS credits
    FROM payledger.ledger_entries
    GROUP BY transaction_id
    HAVING SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END)
        <> SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END)
    LIMIT 5
""")
rows = cur.fetchall()
print("Unbalanced rows count:", len(rows))
if rows:
    print("Unbalanced rows:", rows)
    sample_id = rows[0][0]
    cur.execute("SELECT * FROM payledger.ledger_entries WHERE transaction_id = %s", (sample_id,))
    print("Entries for sample:", cur.fetchall())
