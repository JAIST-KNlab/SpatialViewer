const Peer = window.Peer;
let common = { 
    user_type: user_type, 
    video_size: { width: 280, height: 210 }, 
    room_id: "spacial_viewer_lite", 
    room_connection_mode: "sfu", // or mesh
    local_id: null, 
    fusenn_info: null, 
    stream_ids: [] 
};

(async function main() {

    //v2.ejs中のHTMLのDOM要素を取得
    const localVideo = document.getElementById('js-local-video');
    const videosContainer = document.getElementById('js-videos-container');

    //socket io
    const socket = new io();

    //ローカルのビデオとオーディオを取得
    //容量節約のためにフレームレートや画像サイズを小さくする
    let constraints = {
        video: {
            frameRate: { min: 1, max: 1 }, 
            width: { min: 160, max: 160 },
            height: { min: 120, max: 120 }
        },
        audio: true
    };

    //データ取得
    const localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
    
    const peer = new Peer({
        key: window.__SKYWAY_KEY__,
        debug: 3,
    });

    peer.on('open', (id) => {
        $("#js-local-id").text(id);
        common.local_id = id;
    });

    peer.on('error', console.error);

    //LOGIN
    $("#js-join-trigger").on('click', () => {

        //LOGINを非表示，APPを表示に
        $("#login").css("display", "none");
        $("#app").css("display", "block");

        //自分のビデオの位置を移動
        $("#js-local-component").css({ "position": "absolute", "top": "180px", "left": "980px" });

        //skywayのルームに接続
        const room = peer.joinRoom(common.room_id, {
            mode: common.room_connection_mode,
            stream: localStream,
        });

        //自分が接続したら
        room.on('open', () => {
            socket.emit("peerToServerJoin", { id: common.local_id, username: $("#js-user-name").val() });
            $("#js-messages").append(`===You joined===\n`);
        });

        //他者が接続したら
        room.on('peerJoin', peerId => {
            $("#js-messages").append(`===${peerId} joined===\n`);
        });

        //他者のストリームを受信したら
        room.on('stream', async stream => {

            //コンポーネントを生成
            const remoteComp = $("<div>", {id: stream.peerId, class: "component"});

            //ビデオを作成
            const remoteVideo = document.createElement('video');
            remoteVideo.srcObject = stream;
            remoteVideo.playsInline = true;
            remoteVideo.setAttribute('id', stream.peerId + "-video");

            //音量テキストを作成
            const remoteVideoVol = $("<div>", {id: stream.peerId + "-volume", class: "video-volume", text: "vol:-"});

            //ユーザー名を生成 
            const remoteVideoUsername = $("<div>", {id: stream.peerId + "-username", class: "video-username", text: "-"});

            //ユーザー名をリクエスト． serverToPeerUsernameで受け取る．
            socket.emit("requestUsername", {id:stream.peerId});

            //コンポーネントにすべて入れる
            remoteComp.append(remoteVideo);
            remoteComp.append(remoteVideoVol);
            remoteComp.append(remoteVideoUsername);
            remoteComp.css("position", "absolute");

            remoteComp.draggable({
                //ドラッグ時の処理
                drag: function (e, ui) {
                    //x,y座標
                    let x = $(this).position().left;
                    //let l = $(this).position().left - $(videosContainer).position().left;
                    let y = $(this).position().top;

                    //ビデオが自分に近づけられているかどうかの判定
                    let nf = is_near(x, y);

                    //Componentを変更
                    change_comp(this, x, y);

                    //ドロップ時の処理にデータを渡す
                    remoteComp.data('props', { x: x, y: y, nf: nf });

                },

                //ドロップ時の処理
                stop: function (e, ui) {
                    //ドラッグ時の処理からデータを受け取る
                    let data = remoteComp.data('props');

                    //範囲を超えた際の処理
                    //data.x = 960 - common.video_size.width;
                    if (data.x > 960 - $(this).width()) {
                        data.x = 960 - $(this).width();
                    }
                    if (data.y > 480 - $(this).height()) {
                        data.y = 480 - $(this).height();
                    }

                    //Componentを変更
                    change_comp(this, data.x, data.y);

                    //common.stream_ids(他人のビデオの配置状況)を更新する
                    for (let si = 0; si < common.stream_ids.length; si++) {
                        if (common.stream_ids[si].id == $(this).attr('id')) {
                            common.stream_ids[si].x = data.x;
                            common.stream_ids[si].y = data.y;
                            common.stream_ids[si].near_flag = data.nf;
                        }
                    }
                    //common.stream_idsをサーバーに送る
                    socket.emit("peerToServerUpdateFusennInfo", { id: common.local_id, fusenn_info: common.stream_ids });
                }
            });

            //ページに追加しビデオを開始する
            $('#js-videos-container').append(remoteComp);
            await remoteVideo.play().catch(console.error);

            //x,yの初期値を代入する
            let init_x = Math.floor(Math.random() * 320);
            let init_y = Math.floor(Math.random() * 480);
            change_comp(remoteComp, init_x, init_y);

            //他者ビデオの配置状況を追加
            common.stream_ids.push({ id: stream.peerId, x: init_x, y: init_y, near_flag: 0 });
            //common.stream_idsをサーバーに送る
            socket.emit("peerToServerUpdateFusennInfo", { id: common.local_id, fusenn_info: common.stream_ids });
        });

        //他者ストリームが停止したら
        room.on('peerLeave', peerId => {
            //ビデオを消す
            const remoteVideo = videosContainer.querySelector(`[id='${peerId}-video']`);
            remoteVideo.srcObject.getTracks().forEach(track => {
                track.stop();
            });
            remoteVideo.srcObject = null;
            remoteVideo.remove();

            //コンポーネントを消す
            //const remoteComp = document.getElementById(peerId);
            $("#" + peerId).remove();

            //common.stream_idsの情報を消す
            let delsi = -1;
            for (let si = 0; si < common.stream_ids.length; si++) {
                if (common.stream_ids[si].id == peerId) {
                    delsi = si;
                }
            }
            if (delsi >= 0) {
                common.stream_ids.splice(delsi, 1);
            }

            //common.stream_idsをサーバーに送る
            socket.emit("peerToServerUpdateFusennInfo", { id: common.local_id, fusenn_info: common.stream_ids });

            $("#js-messages").append(`===${peerId} left===\n`);
        });

        //leaveボタンを押したとき全てのストリームを停止しLOGINに戻る
        room.once('close', () => {
            $("#js-messages").append(`===You left===\n`);

            //全てのビデオを停止し削除する
            const remoteVideos = videosContainer.querySelectorAll('video');
            Array.from(remoteVideos)
                .forEach(remoteVideo => {
                    remoteVideo.srcObject.getTracks().forEach(track => track.stop());
                    remoteVideo.srcObject = null;
                    remoteVideo.remove();
                });

            //すべてのコンポーネントを削除する
            const remoteComps = videosContainer.querySelectorAll('.component');
            Array.from(remoteComps)
                .forEach(remoteComp => {
                    remoteComp.remove();
                });

            //他者の配置状況を初期化する
            common.stream_ids = [];

            //自分の情報をサーバーから削除する
            socket.emit("peerToServerDeleteFusennId", { id: common.local_id });
        });

        //leaveボタンが押された時
        $("#js-leave-trigger").on('click', () => {
            room.close(); //すべてのコンポーネントを削除
            $("#app").css("display", "none");
            $("#login").css("display", "block");
            $("#js-local-component").css("position", "static");
        });


        /** Socket IO */
        //送信コマンド一覧
        //socket.emit("peerToServerJoin", { id: common.local_id, username: userName.value });
        //socket.emit("requestUsername", {id:stream.peerId});
        //socket.emit("peerToServerUpdateFusennInfo", { id: common.local_id, fusenn_info: common.stream_ids });
        //socket.emit("peerToServerDeleteFusennId", { id: common.local_id });
 
        //受信コマンド
        //他者が接続した際に名前を取得し反映
        socket.on("serverToPeerUsername", function (data) {
            $("#" + data.id + "-username").html(data.username);
        })

        //配置の更新情報を受信
        socket.on("serverToPeerFusennData", function (data) {
            console.log(data);
            common.fusenn_info = data.data;
            changeBorderCloseFusenn();
        })

    });

    /** 関数群 */
    //Componentの状態変更
    function change_comp(_object, _ox, _oy) {

        //x,y座標の変更
        if (_ox > 960 - $(_object).width()) {
            _ox = 960 - $(_object).width();
        }
        if (_oy > 480 - $(_object).height()) {
            _oy = 480 - $(_object).height();
        }
        $(_object).css("left", _ox);
        $(_object).css("top", _oy);

        //音量の変更
        if ((_ox / 960) >= 0.6) {
            or = 1;
        } else if ((_ox / 960) < 0.1) {
            or = 0.1;
        } else {
            or = _ox / 960;
        }
        //ビデオ音量変更
        $("video[id='" + $(_object).attr('id') + "-video']").prop("volume", (or * or * or));
        //音量テキスト変更
        $("#" + $(_object).attr('id') + "-volume").html("vol:" + Math.round(or * or * or * 10) / 10);

        //サイズの変更
        //Componentのサイズ
        $(_object).css('width', (common.video_size.width * or) + 'px');
        $(_object).css('height', (common.video_size.height * or) + 'px');
        //ビデオのサイズ
        $("video[id='" + $(_object).attr('id') + "-video']").css('width', (common.video_size.width * or) + 'px');
        $("video[id='" + $(_object).attr('id') + "-video']").css('height', (common.video_size.height * or) + 'px');
    }

    //自分に近づけているかどうかを判定する
    function is_near(_x, _y) {
        let onf = 0;
        if (_x > (960 * 0.6)) {
            onf = 1;
        } else {
            onf = 0;
        }
        return onf;
    }

    //相手が自分を近くに配置している場合にボーダーをハイライト
    function changeBorderCloseFusenn() {

        //全てのComponentのボーダーをリセット
        for (let si = 0; si < common.stream_ids.length; si++) {
            $('#' + common.stream_ids[si].id).css('border', 'none');
        }

        //自分を近づけている相手を探す
        for (let fdi = 0; fdi < common.fusenn_info.length; fdi++) {
            let ff = common.fusenn_info[fdi].fusenn_info;
            if (ff != null) {
                for (let ffi = 0; ffi < ff.length; ffi++) {
                    if (ff[ffi].id == common.local_id && ff[ffi].near_flag == 1){
                        for (let si = 0; si < common.stream_ids.length; si++) {
                            if (common.stream_ids[si].id == common.fusenn_info[fdi].id) {
                            //if (common.stream_ids[si].id == common.fusenn_info[fdi].id && common.stream_ids[si].near_flag != 1) {
                                $('#' + common.stream_ids[si].id).css('border', '#ff0000 3px solid');
                            }
                        }
                    }
                }
            }
        }
    }

})();
