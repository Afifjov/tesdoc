# Document Controller App

Aplikasi workflow dokumen untuk Project Manager, Admin, dan Customer External.

## Menjalankan Aplikasi

```powershell
node server.js
```

Buka:

```text
http://localhost:5178
```

Jika PowerShell memblokir `npm start`, jalankan langsung `node server.js`.

## Alur Utama

1. Project Manager mengisi form, memilih `No Doc-Equipment` dari master data, dan melampirkan dokumen untuk Admin.
2. Admin mengecek attachment dari PM lalu memberi keputusan `Approve`, `Reject`, atau `Fwd`.
3. Jika `Reject`, dokumen dikembalikan ke Project Manager.
4. Dokumen yang sudah `Approve` dapat dikirim ke customer external.
5. Admin dapat menambahkan `Attachment Document` saat mengirim dokumen ke customer.
6. Customer terbagi menjadi:
   - `Review only`: hanya melihat dokumen.
   - `Decision`: dapat memberi keputusan `Approve`, `Reject`, atau `Fwd`, serta upload dokumen baru.
7. Saat customer membuka dokumen, status berubah menjadi `Under Review`.
8. Attachment dari PM otomatis disimpan ke folder:

```text
data/pm-attachments/<nomor-dokumen>/
```

9. Attachment dari Admin otomatis disimpan ke folder:

```text
data/admin-attachments/<nomor-dokumen>/
```

10. File upload customer otomatis disimpan ke folder:

```text
data/customer-files/<nomor-dokumen>/
```

## Data

Database lokal tersimpan di:

```text
data/db.json
```

Master equipment awal berada di file tersebut dan bisa dikembangkan sesuai kebutuhan.

## Import Master Data Dari Excel

1. Siapkan master data di Excel dengan header:

```text
equipment_id,equipment_name,area,discipline
```

2. Simpan dari Excel sebagai `CSV UTF-8`.
3. Buka tab `Admin Control`.
4. Pada panel `Import Master Data`, pilih file CSV.
5. Pilih mode:
   - `Update / tambah data`: data dengan `equipment_id` yang sama akan diperbarui, data baru akan ditambahkan.
   - `Replace semua master data`: seluruh master equipment lama diganti dengan isi file CSV.
6. Klik `Import Master Data`.

Contoh isi CSV:

```csv
equipment_id,equipment_name,area,discipline
EQ-PMP-024,Transfer Pump P-024,Utility,Mechanical
EQ-VLV-077,Control Valve XV-077,Line 7,Instrumentation
EQ-MTR-012,Main Motor M-012,Motor Room,Electrical
```
