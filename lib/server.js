var EventEmitter = require('events').EventEmitter;
var WebSocketServer = require('ws').Server;
var url = require('url');
var util = require('./util');
var restify = require('restify');
function PeerMORGServer() {
    
  //singleton
  if (!(this instanceof PeerMORGServer)) {
      return new PeerMORGServer();
  }
    
  EventEmitter.call(this);

  this.appServer = restify.createServer();
  
  //waiting time
  this.waitSec = 30;
  
  //max member num in a room
  this.maxMemberNum = 4;
    
  //port 
  this.port = 9000;
    
  this.roomInfoList = [];
    
  //room info
  this.roomInfo = {};
    
  //all clients
  this.clients = {};

  //init HTTP server
  this._initHTTP();

  //init webSocket
  this._initWebSocket();

  this._watchRoomStatus();
  
  this._cleanRoom();
};

util.inherits(PeerMORGServer, EventEmitter);

PeerMORGServer.prototype._initWebSocket = function() {
    
  var self = this;
  this.wsServer = new WebSocketServer({ path: '/peer', server: this.appServer});
  this.wsServer.on('connection', function(socket) {
      
    var query = url.parse(socket.upgradeReq.url, true).query;
    var id = query.id;
    var name = query.name;
    var token = query.token;
    
    if (!self.clients[id]) {
      self.clients[id] = { token: token, id: id, name: name };
      self._setWs(socket, id, token);
    
      console.log(name + ' is connected!'); 
        
      if(!self._chkProhibitCreateRoom()) {
          self._createRoom(id,name);
      }
      console.log("socket send open.");
      socket.send(JSON.stringify({ type: 'OPEN', roomInfoList: self.roomInfoList}));
    }
  });
};

PeerMORGServer.prototype._setWs = function(socket, id, token) {
    
  var self = this;
  var client = this.clients[id];
    
  if (token === client.token) {
    client.socket = socket;
  }

  socket.on('close', function() {
    if (client.socket == socket) {
      self._removeClient(id);
    }
  });

  socket.on('message', function(data) {
    try {
      var message = JSON.parse(data);

      switch (message.type) {
        case 'NEW':
          self._createRoom(message.id,message.name);
          break;
        case 'JOIN':
          console.log('join room '+message.name);
          self._joinRoom(message);
          break;
        case 'FINISH':
          console.log('goal '+message.id);
          self._finishRace(message);
          break;
        case 'LEAVE':
          if (!message.dst) {
            self._removeClient(id);
            break;
          }
        case 'CANDIDATE':
        case 'OFFER':
        case 'ANSWER':
          self._connectionHandler({
            type: message.type,
            id: message.id,
            farId: message.farId,
            sdp: message.sdp
          });
          break;
      }
    } catch(e) {
      throw e;
      console.log('Invalid message');
    }
  });
}

PeerMORGServer.prototype._initHTTP = function() {
    
    this.appServer.use(restify.bodyParser({ mapParams: false }));
    this.appServer.use(restify.queryParser())
    this.appServer.use(util.allowCrossDomain);
    this.appServer.listen(this.port);
};

PeerMORGServer.prototype._chkProhibitCreateRoom = function() {
    
    if(this.roomInfoList.length == 0) return false;
    var roomList = this.roomInfoList;
    var roomNum = roomList.length;
    for(var i=0;i<roomNum;i++) {
        if(!roomList[i].isStarted && !roomList[i].isTimeout) return true;
    }
    return false;
};

//check room and clean every 10 sec
PeerMORGServer.prototype._cleanRoom = function() {
  var self = this;
  setInterval(function() {
    var roomList = self.roomInfoList;
    var roomNum = roomList.length;
    for(var i=0;i<roomNum;i++) {
        var roomInfo = roomList[i];
        if(roomInfo && (roomInfo.isFinished || roomInfo.isTimeout)) {
            console.log('delete room '+roomList[i].roomId);
            self.roomInfoList.splice(i,1);
        }else if(roomInfo && roomInfo.member.length == 1 && !self.clients[roomInfo.member[0].id]){
            //when there is no client, delete this room 
            console.log('delete room '+roomList[i].roomId);
            self.roomInfoList.splice(i,1);
        }
    }
  }, 10000);
};

PeerMORGServer.prototype._removeClient = function(id) {
  if (this.clients[id]) {
    delete this.clients[id];
      
    console.log('delete client '+this.roomInfoList);
  }
};

PeerMORGServer.prototype._connectionHandler = function(message) {
  var type = message.type;
  var id = message.id;
  var farId = message.farId;
  var sdp = message.sdp;
  var data = JSON.stringify(message);
  var targetClient = this.clients[farId];
  if (targetClient) {
    if (targetClient.socket) {      
        console.log(message.type + '_' + farId);
        targetClient.socket.send(data);
    }else {
        throw "target peer is dead."
    }
  } else {
    
  }
};

PeerMORGServer.prototype._createRoom = function(id,name) {
    var roomInfo = {};
    roomInfo.roomId =  'room_' + makeUUID();
    roomInfo.isStarted = false;
    roomInfo.isTimeout = false;
    roomInfo.isFinished = false;
    roomInfo.remainTime = this.waitSec;
    roomInfo.member = [{id: id,name: name}];
    console.log('add room info ' + roomInfo.roomId + ' '+ name);
    this.roomInfoList.push(roomInfo);
    
    this.clients[id].socket.send(JSON.stringify({ type: 'ROOM_CREATED', roomId: roomInfo.roomId}));
};

PeerMORGServer.prototype._joinRoom = function(message) {  
    console.log(message.roomId);
    var roomList = this.roomInfoList;
    var roomNum = roomList.length;
    var targetRoomId = message.roomId;
    var me = message.id;
    var name = message.name;
    
    console.log('name:: '+name);
    
    for(var i=0;i<roomNum;i++) {
        if(roomList[i].roomId == targetRoomId) {
            console.log('join room '+me);
            
            var member = this.roomInfoList[i].member;
            member.push({id: me, name: name});
            
            var allClients = this.clients;
            
            //accounce all clients 
            for(var c in allClients) {
                this.clients[c].socket.send(JSON.stringify({ type: 'JOIN', roomId: targetRoomId, id:me, name: name}));
            }
            break;
        }
    }
};

PeerMORGServer.prototype._finishRace = function(data) {
    var roomList = this.roomInfoList;
    var roomNum = roomList.length;
    var targetRoomId = data.roomId;
    var winner = data.id;
    console.log("send goal winner "+winner);
    console.log("send goal room "+targetRoomId);
    for(var i=0;i<roomNum;i++) {
        if(roomList[i].roomId == targetRoomId) {
            var member = this.roomInfoList[i].member;
            var memberLen = member.length;
            for(var j=0;j<memberLen;j++) {
                console.log("send goal info send"+winner);
                this.clients[member[j].id].socket.send(JSON.stringify({ type: 'GOAL',id:winner}));
            }
            break;
        }
    }
};

PeerMORGServer.prototype._watchRoomStatus = function() {
    var self = this;
    setInterval(function(){           
        if(!self.roomInfoList) return;
        var list = self.roomInfoList;
        var len = list.length;
        if(len <= 0) return;
                    
        for(var i=0;i<len;i++) {
            var roomInfo = list[i];
            if(!roomInfo || roomInfo.isStarted || roomInfo.isTimeout) continue;
            var remainTime = roomInfo.remainTime;
            var memberlist = roomInfo.member;
            var memberLen = memberlist.length;
            
            if(remainTime > 0) {
                
                if(memberLen <= 0) continue;
                
                //when member num is max
                if(memberLen >= self.maxMemberNum) {
                    for(var j=0;j<memberLen;j++) {
                        var _client = self.clients[memberlist[j].id];
                        if(!_client || !_client.socket) continue;
                        roomInfo.remainTime = 0;
                        _client.socket.send(JSON.stringify({type: 'START',member: memberlist}));
                    }
                    roomInfo.isStarted = true; 
                    continue;
                }else{
                    if(memberLen > 0) roomInfo.remainTime = remainTime = remainTime - 1;
                    for(var k=0;k<memberLen;k++) {
                        var _client = self.clients[memberlist[k].id];
                        if(!_client || !_client.socket) continue;
                        _client.socket.send(JSON.stringify({type: 'COUNTDOWN', remainTime: remainTime}));
                    }
                }
            }else{
                
                //if timeout
                if(memberLen <= 1) {
                    _client = self.clients[memberlist[0].id];
                    if(!_client) continue;
                    _client.socket.send(JSON.stringify({type: 'TIMEOUT',roomId: roomInfo.roomId}));
                    roomInfo.isTimeout = true; 
                }else{
                    for(var l=0;l<memberLen;l++) {
                        _client = self.clients[memberlist[l].id];
                        if(!_client) continue;
                        _client.socket.send(JSON.stringify({type: 'START',member: memberlist}));
                    }
                    roomInfo.isStarted = true;   
                }
            }
        } 
    },1000);
};

var makeUUID = function() {
    var S4 = function() {
        return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
    }   
    return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4() +S4());
}

exports.PeerMORGServer = PeerMORGServer;
