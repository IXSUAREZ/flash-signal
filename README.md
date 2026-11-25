# Flash Signal

Open https://suarezcfi.com/flash-signal/ on both phones. Tap **Sender** on one and **Receiver** on the other. Keep the receiver visible. When the sender says **Receiver ready**, tap A through E for one through five flashes. Tap the receiver screen to return to role selection.

Tap the gear on the role chooser to change the shared flash speed or adjust intensity on this phone. Preview plays three flashes locally. The relay retains the latest shared speed for new visitors.

The two role shortcuts are [/send/](https://suarezcfi.com/flash-signal/send/) and [/receive/](https://suarezcfi.com/flash-signal/receive/).

GitHub Pages serves the static files from main. The browser connects to the public EMQX test broker over secure WebSockets on port 8084. All visitors share one public channel. Availability depends on the broker and the network allowing this connection. The app uses ephemeral playback messages, fresh receiver IDs on reconnect, and playback acknowledgments. Reloading or returning to the receiver starts a fresh listening session.

For local use, serve this directory with `python3 -m http.server 8000` and open localhost:8000. Use HTTPS for deployment. The bundled browser client is MQTT.js 5.10.4; its license is in vendor/.
