# Flash Signal

Open https://ixsuarez.github.io/flash-signal/ on both phones. Tap **Sender** on one and **Receiver** on the other. Keep the receiver visible. When the sender says **Receiver ready**, tap A through E for one through five white flashes. Tap the receiver screen to return to role selection.

The two role shortcuts are [/send/](https://ixsuarez.github.io/flash-signal/send/) and [/receive/](https://ixsuarez.github.io/flash-signal/receive/).

GitHub Pages serves the static files from main. The browser connects to the public EMQX test broker over secure WebSockets on port 8084. All visitors share one public channel. Availability depends on the broker and the network allowing this connection. The app uses ephemeral messages, fresh receiver IDs on reconnect, and playback acknowledgments. Reloading or returning to the receiver starts a fresh listening session.

For local use, serve this directory with `python3 -m http.server 8000` and open localhost:8000. Use HTTPS for deployment. The bundled browser client is MQTT.js 5.10.4; its license is in vendor/.
