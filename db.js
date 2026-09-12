/* =================================================================
   db.js - Lapisan Database (Firebase Realtime Database) untuk
   WMS Bahan Kemas PT MMI

   File ini menangani:
   - Konfigurasi & inisialisasi Firebase (pakai SDK "compat" yang
     sudah di-load lewat <script> di <head> index.html:
     firebase-app-compat.js & firebase-database-compat.js)
   - Sinkronisasi realtime dua arah antara localStorage (appDB) <-> Firebase
   - Fungsi saveDB(), pullDataFromServer(), manualRefreshFromFirebase()

   CARA PAKAI:
   1. Taruh file ini satu folder dengan index.html.
   2. Di index.html, pastikan urutan <script> seperti ini (SDK compat
      dulu, baru db.js, baru script utama aplikasi):
        <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
        <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"></script>
        <script src="db.js"></script>
        <script> ... sisa logika aplikasi (login, render, CRUD) ... </script>

   PENTING - WAJIB DIISI:
   - Ganti nilai "databaseURL" di bawah dengan URL asli project Anda.
     Lihat di Firebase Console > Build > Realtime Database, URL-nya
     tertulis di bagian atas halaman, formatnya kira-kira:
     https://gbk-wms-mmi-default-rtdb.<region>.firebasedatabase.app
   - Pastikan juga Rules Realtime Database mengizinkan read/write,
     karena aplikasi ini belum pakai Firebase Authentication (login
     dicek manual lewat data user di dalam database, bukan Firebase Auth).
     Untuk testing, di tab Rules bisa pakai:
       { "rules": { ".read": true, ".write": true } }
     (ini masih terbuka untuk siapapun yang tahu URL project - perketat
     lagi nanti sebelum dipakai produksi sungguhan).
================================================================= */

  // Konfigurasi Firebase (memakai SDK "compat" yang sudah di-load di <head>: firebase-app-compat.js & firebase-database-compat.js)
  // PENTING: databaseURL WAJIB diisi persis dengan URL yang tertulis di Firebase Console > Build > Realtime Database.
  // Tanpa databaseURL yang benar, firebase.database() akan gagal/exception dan aplikasi otomatis jatuh ke mode lokal (localStorage per-browser),
  // sehingga data tidak pernah benar-benar tersimpan/terlihat di Firebase Console. INI PENYEBAB UTAMA data tabel tidak muncul di database.
  const firebaseConfig = {
  apiKey: "AIzaSyCZlkmamTnheqvj4InXNYy5hhyKqOMv3j8",
  authDomain: "gbk-wms-mmi.firebaseapp.com",
  databaseURL: "https://gbk-wms-mmi-default-rtdb.asia-southeast1.firebasedatabase.app", // <-- GANTI dengan URL asli project Anda dari Firebase Console
  projectId: "gbk-wms-mmi",
  storageBucket: "gbk-wms-mmi.firebasestorage.app",
  messagingSenderId: "457943014631",
  appId: "1:457943014631:web:b79acdaf6edd8ebe965642"
};

    // Inisialisasi Firebase jika CDN SDK dimuat dan valid
    let db = null;
    let wmsRef = null;
    let isFirebaseConnected = false;
    let isRemoteUpdating = false;

    try {
      if (typeof firebase !== 'undefined' && firebaseConfig.apiKey !== "YOUR_API_KEY") {
        if (!firebase.apps.length) {
          firebase.initializeApp(firebaseConfig);
        }
        db = firebase.database();
        wmsRef = db.ref('wms_data');

        // Monitoring koneksi Firebase
        db.ref('.info/connected').on('value', (snap) => {
          isFirebaseConnected = (snap.val() === true);
          const dot = document.getElementById('firebaseDot');
          const txt = document.getElementById('syncStatusText');
          const badge = document.getElementById('syncStatusBadge');
          if (isFirebaseConnected) {
            if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
            if (txt) txt.textContent = "Firebase Cloud Terhubung";
            if (badge) badge.className = "hidden sm:inline-flex text-[11px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 font-semibold border border-emerald-200 items-center gap-1.5";
          } else {
            if (dot) dot.className = "w-2 h-2 rounded-full bg-amber-500";
            if (txt) txt.textContent = "Database Lokal (Offline)";
            if (badge) badge.className = "hidden sm:inline-flex text-[11px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 font-semibold border border-amber-200 items-center gap-1.5";
          }
        });

        // Sync Real-Time dari Firebase (Otomatis ketika ada perubahan dari siapapun)
        wmsRef.on('value', (snapshot) => {
          const remoteData = snapshot.val();
          if (remoteData) {
            isRemoteUpdating = true;
            appDB = remoteData;
            if (!appDB.kategoriBarang) appDB.kategoriBarang = DEFAULT_DATA.kategoriBarang.slice();
            localStorage.setItem('WMS_MMI_DB', JSON.stringify(appDB));
            
            const lastSyncedAt = new Date();
            const lbl = document.getElementById('lastSyncedLabel');
            if (lbl) lbl.textContent = 'Sinkron: ' + lastSyncedAt.toLocaleTimeString('id-ID');

            if (document.getElementById('mainApp') && !document.getElementById('mainApp').classList.contains('hidden')) {
              if (!isAnyModalOpen()) {
                renderAll();
              }
            }
            isRemoteUpdating = false;
          } else {
            // Upload data awal ke Firebase jika masih kosong
            wmsRef.set(appDB).catch(err => {
              console.error("Gagal menulis data awal ke Firebase:", err);
              showToast('Gagal menyimpan ke Firebase: ' + err.message + ' (cek Rules Realtime Database)', 'error');
            });
          }
        }, (err) => {
          console.error("Gagal membaca data dari Firebase:", err);
          showToast('Gagal terhubung ke Firebase: ' + err.message + ' (cek databaseURL & Rules)', 'error');
          const dot = document.getElementById('firebaseDot');
          const txt = document.getElementById('syncStatusText');
          if (dot) dot.className = "w-2 h-2 rounded-full bg-rose-500";
          if (txt) txt.textContent = "Firebase Error - Cek Rules/URL";
        });
      }
    } catch(e) {
      console.warn("Firebase belum diatur atau berjalan mode offline:", e);
      showToast('Firebase gagal diinisialisasi: ' + e.message, 'error');
    }

    // Initial Seed Data
    const DEFAULT_DATA = {
      kategoriBarang: ["Kemasan Primer", "Kemasan Sekunder", "Label & Stiker", "Tutup / Cap", "Aksesoris Kemas"],
      users: [
        { id: "USR-001", nama: "Admin Gudang", username: "superadmin", pass: "admin123", role: "superadmin", dept: "IT & Supply Chain", status: "Aktif" },
        { id: "USR-002", nama: "Gunawan (Manager)", username: "manager", pass: "mgr123", role: "manager", dept: "Warehouse & Logistics", status: "Aktif" },
        { id: "USR-003", nama: "Rahmat (SPV)", username: "spv", pass: "spv123", role: "supervisor", dept: "Gudang Bahan Kemas", status: "Aktif" },
        { id: "USR-004", nama: "Dedi (Staff)", username: "staff", pass: "staff123", role: "staff", dept: "Gudang Bahan Kemas", status: "Aktif" }
      ],
      barang: [
        { kode: "BK-BTL-100", nama: "Botol Kaca Amber 100ml", kategori: "Kemasan Primer", satuan: "Pcs", minStok: 500, stok: 1500, lokasi: "RAK-A1" },
        { kode: "BK-CAP-028", nama: "Tutup Botol Cap 28mm White", kategori: "Tutup / Cap", satuan: "Pcs", minStok: 1000, stok: 3500, lokasi: "RAK-A2" },
        { kode: "BK-LBL-PRM", nama: "Stiker Label Primer Sirup 100ml", kategori: "Label & Stiker", satuan: "Roll", minStok: 50, stok: 15, lokasi: "RAK-B1" },
        { kode: "BK-BOX-OUT", nama: "Karton Box Master 40x30x20", kategori: "Kemasan Sekunder", satuan: "Pcs", minStok: 200, stok: 450, lokasi: "RAK-C1" },
        { kode: "BK-TUB-050", nama: "Tube Alumunium Salep 50gr", kategori: "Kemasan Primer", satuan: "Pcs", minStok: 300, stok: 80, lokasi: "RAK-A3" }
      ],
      suplier: [
        { kode: "SUP-001", nama: "PT Mega Kemas Abadi", pic: "Hendra Wijaya", telp: "0811-2233-4455", email: "sales@megakemas.com", alamat: "Jl. Industri Raya No. 12, Cikarang" },
        { kode: "SUP-002", nama: "CV Prima Label Grafika", pic: "Siti Rahma", telp: "0812-9988-7766", email: "order@primalabel.co.id", alamat: "Kawasan Industri Pulo Gadung, Jakarta" },
        { kode: "SUP-003", nama: "PT Boxindo Packaging", pic: "Bambang K.", telp: "0813-4455-6677", email: "info@boxindo.com", alamat: "Jl. Raya Narogong Km 14, Bekasi" }
      ],
      lokasi: [
        { kode: "RAK-A1", nama: "Rak Kemas Primer 01", zona: "Zona Primer", kapasitas: "8 Pallet", ket: "Suhu Ruang AC 20-25C" },
        { kode: "RAK-A2", nama: "Rak Tutup & Plug 02", zona: "Zona Primer", kapasitas: "10 Pallet", ket: "Dekat pintu staging" },
        { kode: "RAK-B1", nama: "Rak Stiker & Label Roll", zona: "Zona Sekunder", kapasitas: "500 Roll", ket: "Area kering / dehumidifier" },
        { kode: "RAK-C1", nama: "Rak Box & Outer Karton", zona: "Zona Sekunder", kapasitas: "15 Pallet", ket: "Area pallet tebal" },
        { kode: "KARANTINA", nama: "Area Karantina QC Kemas", zona: "Zona Karantina", kapasitas: "4 Pallet", ket: "Menunggu rilis QA/QC" }
      ],
      penerimaan: [
        {
          noLPB: "LPB/MMI/2026/08/0001",
          tanggal: "2026-08-15",
          noSJ: "SJ-MKA-8901",
          suplier: "PT Mega Kemas Abadi",
          penginput: "Dedi (Staff)",
          status: "Disetujui",
          approvedBy: "Gunawan (Manager)",
          catatan: "Kondisi kardus rapi dan segel utuh.",
          items: [
            { barangKode: "BK-BTL-100", nama: "Botol Kaca Amber 100ml", batch: "MKA2608A", qtySJ: 500, qtyTerima: 500, qtyReject: 0, lokasi: "RAK-A1", qcNotes: "Lulus Uji Visual" }
          ]
        },
        {
          noLPB: "LPB/MMI/2026/08/0002",
          tanggal: "2026-08-20",
          noSJ: "PL-0992/VIII",
          suplier: "CV Prima Label Grafika",
          penginput: "Dedi (Staff)",
          status: "Menunggu Persetujuan",
          approvedBy: "-",
          catatan: "Label cetak batch sirup edisi baru.",
          items: [
            { barangKode: "BK-LBL-PRM", nama: "Stiker Label Primer Sirup 100ml", batch: "PLG-881", qtySJ: 20, qtyTerima: 20, qtyReject: 0, lokasi: "RAK-B1", qcNotes: "Warna tajam, barcode scan ok" }
          ]
        }
      ],
      pengeluaran: [
        {
          noSBPB: "SBPB/MMI/2026/08/0001",
          tanggal: "2026-08-18",
          tujuan: "Line Kemas Primer 1",
          noSPK: "WO-SYRUP-881",
          penginput: "Dedi (Staff)",
          status: "Disetujui",
          approvedBy: "Rahmat (SPV)",
          catatan: "Kebutuhan filling sirup batch 1.",
          items: [
            { barangKode: "BK-BTL-100", nama: "Botol Kaca Amber 100ml", batch: "MKA2608A", qtyMinta: 200, qtyKeluar: 200, ket: "Filling line 1" }
          ]
        },
        {
          noSBPB: "SBPB/MMI/2026/08/0002",
          tanggal: "2026-08-21",
          tujuan: "Line Kemas Sekunder A",
          noSPK: "WO-BOX-991",
          penginput: "Dedi (Staff)",
          status: "Menunggu Persetujuan",
          approvedBy: "-",
          catatan: "Kebutuhan packing luar.",
          items: [
            { barangKode: "BK-BOX-OUT", nama: "Karton Box Master 40x30x20", batch: "BOX-08A", qtyMinta: 50, qtyKeluar: 50, ket: "Packing outer" }
          ]
        }
      ],
      logs: [
        { timestamp: "2026-08-21 08:30:12", user: "Dedi (Staff)", role: "staff", type: "LOGIN", desc: "User login ke aplikasi WMS" },
        { timestamp: "2026-08-21 09:15:40", user: "Dedi (Staff)", role: "staff", type: "CREATE_LPB", desc: "Membuat Lembar Penerimaan LPB/MMI/2026/08/0002 (CV Prima Label Grafika)" },
        { timestamp: "2026-08-21 10:02:11", user: "Rahmat (SPV)", role: "supervisor", type: "APPROVE_SBPB", desc: "Menyetujui Pengeluaran SBPB/MMI/2026/08/0001 (Line Kemas Primer 1)" },
        { timestamp: "2026-08-21 11:20:00", user: "Gunawan (Manager)", role: "manager", type: "LOGIN", desc: "Manager login & monitoring produktivitas gudang" }
      ]
    };

    // ================= VERSI APLIKASI =================
    const APP_VERSION = "6.0.0";
    const savedAppVersion = localStorage.getItem('WMS_MMI_APP_VERSION');
    if (savedAppVersion !== APP_VERSION) {
      localStorage.removeItem('WMS_MMI_USER');
      localStorage.setItem('WMS_MMI_APP_VERSION', APP_VERSION);
    }

    let appDB = JSON.parse(localStorage.getItem('WMS_MMI_DB')) || DEFAULT_DATA;
    if (!appDB.users || !Array.isArray(appDB.users) || appDB.users.length === 0) appDB.users = DEFAULT_DATA.users.slice();
    if (!appDB.barang || !Array.isArray(appDB.barang) || appDB.barang.length === 0) appDB.barang = DEFAULT_DATA.barang.slice();
    if (!appDB.suplier || !Array.isArray(appDB.suplier)) appDB.suplier = DEFAULT_DATA.suplier.slice();
    if (!appDB.lokasi || !Array.isArray(appDB.lokasi)) appDB.lokasi = DEFAULT_DATA.lokasi.slice();
    if (!appDB.kategoriBarang || !Array.isArray(appDB.kategoriBarang) || appDB.kategoriBarang.length === 0) appDB.kategoriBarang = DEFAULT_DATA.kategoriBarang.slice();
    if (!appDB.penerimaan || !Array.isArray(appDB.penerimaan)) appDB.penerimaan = DEFAULT_DATA.penerimaan.slice();
    if (!appDB.pengeluaran || !Array.isArray(appDB.pengeluaran)) appDB.pengeluaran = DEFAULT_DATA.pengeluaran.slice();
    if (!appDB.logs || !Array.isArray(appDB.logs)) appDB.logs = DEFAULT_DATA.logs.slice();

    let currentUser = JSON.parse(localStorage.getItem('WMS_MMI_USER')) || null;
    let myChart1 = null;
    let myChart2 = null;


    function saveDB() {
      localStorage.setItem('WMS_MMI_DB', JSON.stringify(appDB));
      if (wmsRef && !isRemoteUpdating) {
        wmsRef.set(appDB).catch(err => {
          console.warn("Firebase save warning:", err);
          showToast('Gagal sync ke Firebase: ' + err.message, 'error');
        });
      }
    }

    function triggerBackgroundSync(actionDesc = 'Update Data') {
      saveDB();
      renderAll();
      showToast(`Data tersimpan ke Firebase (${actionDesc})`, 'success');
    }

    function isAnyModalOpen() {
      return Array.from(document.querySelectorAll('div.fixed[id^="modal"]'))
        .some(m => !m.classList.contains('hidden'));
    }

    function pullDataFromServer(silent = true) {
      manualRefreshFromFirebase(silent);
    }

    function manualRefreshFromFirebase(silent = false) {
      const icon = document.getElementById('pullSyncIcon');
      if (icon) icon.classList.add('fa-spin');
      if (!silent) showToast('Memuat data dari Firebase...', 'info');

      if (wmsRef) {
        wmsRef.once('value').then((snapshot) => {
          const remoteData = snapshot.val();
          if (remoteData) {
            appDB = remoteData;
            localStorage.setItem('WMS_MMI_DB', JSON.stringify(appDB));
            renderAll();
            const lastSyncedAt = new Date();
            const lbl = document.getElementById('lastSyncedLabel');
            if (lbl) lbl.textContent = 'Sinkron: ' + lastSyncedAt.toLocaleTimeString('id-ID');
            if (!silent) showToast('✓ Data Firebase berhasil dimuat!', 'success');
          }
        }).catch(err => {
          if (!silent) showToast('Gagal memuat: ' + err.message, 'error');
        }).finally(() => {
          if (icon) icon.classList.remove('fa-spin');
        });
      } else {
        if (!silent) showToast('Mode Lokal (localStorage) Aktif', 'info');
        if (icon) icon.classList.remove('fa-spin');
      }
    }
