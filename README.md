# 🎥 MCAP Multi-Camera Web Player

Aplikasi web sederhana berbasis **FastAPI (Python)** dan **HTML5** untuk membaca, mengonversi, dan memutar channel video dari file `.mcap` (Foxglove Compressed Video Protobuf) secara langsung di browser tanpa memerlukan antarmuka ROS 2 atau GUI Desktop.

---

## 📋 Prasyarat Sistem

* **OS:** Ubuntu 20.04 / 22.04 / 24.04 (Linux)
* **Tools:** `ffmpeg`, `python3`, `python3-venv`

---

## 🚀 Langkah Instalasi & Penggunaan

### 1. Persiapan Dependensi Sistem

Pastikan paket `ffmpeg` dan `python3-venv` sudah terinstall di sistem Ubuntu kamu:

```bash
sudo apt update
sudo apt install -y ffmpeg python3-pip python3-venv python3-full
```


### 2. Buat & Aktifkan Python Virtual Environment

Buat lingkungan terisolasi (virtual environment) agar instalasi paket Python aman dan tidak bentrok dengan paket bawaan sistem:

```bash
# 1. Buat folder virtual environment
python3 -m venv env_mcap

# 2. Aktifkan virtual environment
source env_mcap/bin/activate

pip install -r requirements.txt
```

Catatan: Jika berhasil diaktifkan, indikator (env_mcap) akan muncul di sebelah kiri nama terminal kamu.

### 3. Install Package Python

Dalam kondisi virtual environment aktif (env_mcap), jalankan perintah berikut:

```bash
pip install fastapi uvicorn mcap protobuf
```

### 4. Struktur File Proyek

Pastikan struktur file di folder kerja kamu terlihat seperti ini:

```
.
├── env_mcap/          # Folder Virtual Environment
├── server.py          # Script Backend FastAPI
├── index.html         # Frontend Web Player
└── README.md          # Dokumentasi Proyek
```

### 5. Jalankan Aplikasi Server

Jalankan server menggunakan Python dalam environment (env_mcap):

```bash
python3 server.py
```

### 6. Akses Pemutar Video di Browser

Buka browser di PC/laptop kamu dan navigasikan ke alamat IP server Ubuntu kamu:

```
http://<IP-UBUNTU-KAMU>:8100
```
