# Spotify AutoEQ Status

[English README](https://github.com/hllerden/spotify-autoeq-gnome/blob/main/README.md)

[![CI](https://github.com/hllerden/spotify-autoeq-gnome/actions/workflows/ci.yml/badge.svg)](https://github.com/hllerden/spotify-autoeq-gnome/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/hllerden/spotify-autoeq-gnome/blob/main/LICENSE)

[spotify-autoeq](https://github.com/hllerden/spotify-autoeq) için GNOME Shell
panel göstergesi. spotify-autoeq, Spotify'da çalan şarkının türüne göre
ekolayzırınızı otomatik değiştiren servistir. Gösterge salt okunurdur: hangi
profilin uygulandığını, nedenini ve her şeyin sağlıklı olup olmadığını gösterir.

![Panel düğmesi](https://raw.githubusercontent.com/hllerden/spotify-autoeq-gnome/main/docs/screenshots/panel-active.png)

| Çalarken | Arka uç hatası | Servis durmuş |
|---|---|---|
| ![Çalarken açılır menü](https://raw.githubusercontent.com/hllerden/spotify-autoeq-gnome/main/docs/screenshots/popup-active.png) | ![Hata durumunda açılır menü](https://raw.githubusercontent.com/hllerden/spotify-autoeq-gnome/main/docs/screenshots/popup-error.png) | ![Servis durmuşken açılır menü](https://raw.githubusercontent.com/hllerden/spotify-autoeq-gnome/main/docs/screenshots/popup-stopped.png) |

## Ne gösterir

- **Panel düğmesi:** ekolayzır simgesi ve profil adı (`Rock`, `Pop`, ...).
  Sabit genişlikli bir alanda durur, bu yüzden yanındaki öğeler kaymaz. Servis
  durunca düğme soluklaşır ve `Off` yazar; ekolayzır arka ucu hata verirse uyarı
  simgesi çıkar.
- **Açılır menü:** servis ve arka uç durumu, çalan şarkı (çalıyor veya
  duraklatıldı), sanatçı için bulunan türler ve nereden geldikleri, uygulanan
  profil ve ne zaman uygulandığı, ve ekolayzırın on bantlı eğrisi. Arka uç
  hata verirken bir hata şeridi görünür ve eğri kesikli çizilir; yani profil
  etkin değildir.
- **Bağlantılar:** servis logunu aç, ayar dosyasını aç ve proje sayfası.

Durum yalnızca renkle değil şekil ve yazıyla da anlatılır; menü, kabuk temanızın
açık veya koyu görünümünü izler.

## Gereksinimler

- GNOME Shell **42** (Ubuntu 22.04). Diğer sürümler henüz desteklenmiyor, aşağıya bakın.
- [spotify-autoeq](https://github.com/hllerden/spotify-autoeq) **1.1 veya üzeri**;
  göstergenin okuduğu durum dosyasını yazar.

## Kurulum

Yayın zip'inden:

```
gnome-extensions install --force spotify-autoeq-status@hllerden.github.io.zip
gnome-extensions enable spotify-autoeq-status@hllerden.github.io
```

Kaynak klasöründen:

```
make install
gnome-extensions enable spotify-autoeq-status@hllerden.github.io
```

İlk kurulumdan sonra X11'de `Alt+F2`, `r`, Enter ile kabuğu yeniden yükleyin;
Wayland'de oturumu kapatıp açın. Kaldırmak için `make uninstall` veya
`gnome-extensions uninstall spotify-autoeq-status@hllerden.github.io`.

Düğmede `Off` yazıyorsa spotify-autoeq servisi çalışmıyordur:
`spotify-autoeq service install` ile başlatın (proje sayfasına bakın).

## Nasıl çalışır

spotify-autoeq, bir şey değiştiğinde `$XDG_RUNTIME_DIR/spotify-autoeq/status.json`
dosyasını yeniden yazar. Eklenti bu dizini bir dosya izleyicisiyle izler ve her
değişimde yeniden çizer. Beş saniyelik bir kontrol, veda etmeden ölen servisi
fark eder. Biçim belgelenmiş, sürümlü bir sözleşmedir:
[status-file.md](https://github.com/hllerden/spotify-autoeq/blob/main/docs/status-file.md).

## Desteklenen GNOME sürümleri

GNOME Shell 42.9 (Ubuntu 22.04) üzerinde geliştirildi ve denendi: tüm durumlar
yalıtılmış bir kabuk oturumunda çalıştırıldı, mantık birim testlidir. GNOME 43 ve
44 kabuk API'sinin bazı kısımlarını değiştirdi, GNOME 45 ve sonrası ise ES modül
biçimli eklenti ister; her biri ayrı bir uyarlama gerektirir ve biri denemeden
`metadata.json`'a yazılmadı. Katkılara açığız, bkz.
[CONTRIBUTING.md](https://github.com/hllerden/spotify-autoeq-gnome/blob/main/CONTRIBUTING.md).

## Geliştirme

```
make test     # düz gjs ile mantık testleri
make pack     # testler, sonra dist/<uuid>.zip
```

## Lisans

MIT, bkz. [LICENSE](https://github.com/hllerden/spotify-autoeq-gnome/blob/main/LICENSE).
