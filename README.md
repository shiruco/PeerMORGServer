# webRTC アプリケーションサーバ
STUNサーバから取得した接続先情報の受け渡しとステージ情報の管理、接続中のクライアント情報の管理などを担う。

#### モジュールのインストール
```
npm install peer-morg-server
```

#### app.jsを作成
```
var peerMORGServer = require('peer-morg-server').PeerMORGServer;
var server = new peerMORGServer();
```

#### サーバを起動
```
forever start app.js
```