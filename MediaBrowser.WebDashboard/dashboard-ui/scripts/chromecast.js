﻿(function (window, chrome, console) {

    // Based on https://github.com/googlecast/CastVideos-chrome/blob/master/CastVideos.js

    /**
     * Constants of states for Chromecast device 
     **/
    var DEVICE_STATE = {
        'IDLE': 0,
        'ACTIVE': 1,
        'WARNING': 2,
        'ERROR': 3,
    };

    /**
     * Constants of states for CastPlayer 
     **/
    var PLAYER_STATE = {
        'IDLE': 'IDLE',
        'LOADING': 'LOADING',
        'LOADED': 'LOADED',
        'PLAYING': 'PLAYING',
        'PAUSED': 'PAUSED',
        'STOPPED': 'STOPPED',
        'SEEKING': 'SEEKING',
        'ERROR': 'ERROR'
    };

    var CastPlayer = function () {

        /* device variables */
        // @type {DEVICE_STATE} A state for device
        this.deviceState = DEVICE_STATE.IDLE;

        /* Cast player variables */
        // @type {Object} a chrome.cast.media.Media object
        this.currentMediaSession = null;
        // @type {Number} volume
        this.currentVolume = 0.5;
        // @type {Boolean} A flag for autoplay after load
        this.autoplay = true;
        // @type {string} a chrome.cast.Session object
        this.session = null;
        // @type {PLAYER_STATE} A state for Cast media player
        this.castPlayerState = PLAYER_STATE.IDLE;

        // @type {Boolean} Fullscreen mode on/off
        this.fullscreen = false;

        /* Current media variables */
        // @type {Boolean} Audio on and off
        this.audio = true;
        // @type {Number} A number for current media index
        this.currentMediaIndex = 0;
        // @type {Number} A number for current media time
        this.currentMediaTime = 0;
        // @type {Number} A number for current media duration
        this.currentMediaDuration = -1;
        // @type {Timer} A timer for tracking progress of media
        this.timer = null;
        // @type {Boolean} A boolean to stop timer update of progress when triggered by media status event 
        this.progressFlag = true;
        // @type {Number} A number in milliseconds for minimal progress update
        this.timerStep = 1000;

        /* media contents from JSON */
        this.mediaContents = null;

        this.hasReceivers = false;

        this.initializeCastPlayer();
    };

    /**
     * Initialize Cast media player 
     * Initializes the API. Note that either successCallback and errorCallback will be
     * invoked once the API has finished initialization. The sessionListener and 
     * receiverListener may be invoked at any time afterwards, and possibly more than once. 
     */
    CastPlayer.prototype.initializeCastPlayer = function () {

        if (!chrome) {
            return;
        }

        if (!chrome.cast || !chrome.cast.isAvailable) {

            setTimeout(this.initializeCastPlayer.bind(this), 1000);
            return;
        }

        var applicationID = 'AE4DA10A';

        // request session
        var sessionRequest = new chrome.cast.SessionRequest(applicationID);
        var apiConfig = new chrome.cast.ApiConfig(sessionRequest,
          this.sessionListener.bind(this),
          this.receiverListener.bind(this));

        console.log('chrome.cast.initialize');

        chrome.cast.initialize(apiConfig, this.onInitSuccess.bind(this), this.onError.bind(this));
    };

    /**
     * Callback function for init success 
     */
    CastPlayer.prototype.onInitSuccess = function () {
        console.log("init success");
    };

    /**
     * Generic error callback function 
     */
    CastPlayer.prototype.onError = function () {
        console.log("chromecast error");
    };

    /**
     * @param {!Object} e A new session
     * This handles auto-join when a page is reloaded
     * When active session is detected, playback will automatically
     * join existing session and occur in Cast mode and media
     * status gets synced up with current media of the session 
     */
    CastPlayer.prototype.sessionListener = function (e) {
        this.session = e;
        if (this.session) {
            this.deviceState = DEVICE_STATE.ACTIVE;
            
            if (this.session.media[0]) {
                this.onMediaDiscovered('activeSession', this.session.media[0]);
            }
            
            this.session.addUpdateListener(this.sessionUpdateListener.bind(this));
        }
    };

    /**
     * @param {string} e Receiver availability
     * This indicates availability of receivers but
     * does not provide a list of device IDs
     */
    CastPlayer.prototype.receiverListener = function (e) {

        console.log("cast.receiverListener", e);

        if (e === 'available') {
            console.log("chromecast receiver found");
            this.hasReceivers = true;
        }
        else {
            console.log("chromecast receiver list empty");
            this.hasReceivers = false;
        }
    };

    /**
     * session update listener
     */
    CastPlayer.prototype.sessionUpdateListener = function (isAlive) {
        if (!isAlive) {
            this.session = null;
            this.deviceState = DEVICE_STATE.IDLE;
            this.castPlayerState = PLAYER_STATE.IDLE;
            this.currentMediaSession = null;
            clearInterval(this.timer);

            MediaController.removeActivePlayer('Chromecast');
        }
    };

    /**
     * Requests that a receiver application session be created or joined. By default, the SessionRequest
     * passed to the API at initialization time is used; this may be overridden by passing a different
     * session request in opt_sessionRequest. 
     */
    CastPlayer.prototype.launchApp = function () {
        console.log("launching app...");
        chrome.cast.requestSession(this.onRequestSessionSuccess.bind(this), this.onLaunchError.bind(this));
        if (this.timer) {
            clearInterval(this.timer);
        }
    };

    /**
     * Callback function for request session success 
     * @param {Object} e A chrome.cast.Session object
     */
    CastPlayer.prototype.onRequestSessionSuccess = function (e) {
        console.log("session success: " + e.sessionId);
        this.session = e;
        this.deviceState = DEVICE_STATE.ACTIVE;
        this.session.addUpdateListener(this.sessionUpdateListener.bind(this));
    };

    /**
     * Callback function for launch error
     */
    CastPlayer.prototype.onLaunchError = function () {
        console.log("launch error");
        this.deviceState = DEVICE_STATE.ERROR;
        Dashboard.alert({

            title: "Error Launching Chromecast",
            message: "There was an error launching chromecast. Please ensure your device is connected to your wifi network."

        });

        MediaController.removeActivePlayer('Chromecast');
    };

    /**
     * Stops the running receiver application associated with the session.
     */
    CastPlayer.prototype.stopApp = function () {
        this.session.stop(this.onStopAppSuccess.bind(this, 'Session stopped'),
            this.onError.bind(this));

    };

    /**
     * Callback function for stop app success 
     */
    CastPlayer.prototype.onStopAppSuccess = function (message) {
        console.log(message);
        this.deviceState = DEVICE_STATE.IDLE;
        this.castPlayerState = PLAYER_STATE.IDLE;
        this.currentMediaSession = null;
        clearInterval(this.timer);

        //// continue to play media locally
        //console.log("current time: " + this.currentMediaTime);
        //this.playMediaLocally(this.currentMediaTime);
    };

    /**
     * Loads media into a running receiver application
     * @param {Number} mediaIndex An index number to indicate current media content
     */
    CastPlayer.prototype.loadMedia = function (mediaIndex) {
        
        if (!this.session) {
            console.log("no session");
            return;
        }
        
        //console.log("loading..." + this.mediaContents[mediaIndex]['title']);
        
        //var mediaInfo = new chrome.cast.media.MediaInfo(this.mediaContents[mediaIndex]['sources'][0]);
        
        //mediaInfo.contentType = 'video/mp4';
        //var request = new chrome.cast.media.LoadRequest(mediaInfo);
        //request.autoplay = this.autoplay;
        //if (this.localPlayerState == PLAYER_STATE.PLAYING) {
        //    request.currentTime = this.localPlayer.currentTime;
        //}
        //else {
        //    request.currentTime = 0;
        //}
        //var payload = {
        //    "title:": this.mediaContents[0]['title'],
        //    "thumb": this.mediaContents[0]['thumb']
        //};

        //var json = {
        //    "payload": payload
        //};

        //request.customData = json;

        //this.castPlayerState = PLAYER_STATE.LOADING;
        //this.session.loadMedia(request,
        //  this.onMediaDiscovered.bind(this, 'loadMedia'),
        //  this.onLoadMediaError.bind(this));

        //document.getElementById("media_title").innerHTML = this.mediaContents[this.currentMediaIndex]['title'];
        //document.getElementById("media_subtitle").innerHTML = this.mediaContents[this.currentMediaIndex]['subtitle'];
        //document.getElementById("media_desc").innerHTML = this.mediaContents[this.currentMediaIndex]['description'];

    };

    /**
     * Callback function for loadMedia success
     * @param {Object} mediaSession A new media object.
     */
    CastPlayer.prototype.onMediaDiscovered = function (how, mediaSession) {
        
        console.log("new media session ID:" + mediaSession.mediaSessionId + ' (' + how + ')');
        this.currentMediaSession = mediaSession;
        if (how == 'loadMedia') {
            if (this.autoplay) {
                this.castPlayerState = PLAYER_STATE.PLAYING;
            }
            else {
                this.castPlayerState = PLAYER_STATE.LOADED;
            }
        }

        if (how == 'activeSession') {
            this.castPlayerState = this.session.media[0].playerState;
            this.currentMediaTime = this.session.media[0].currentTime;
        }

        if (this.castPlayerState == PLAYER_STATE.PLAYING) {
            // start progress timer
            //this.startProgressTimer(this.incrementMediaTime);
        }

        this.currentMediaSession.addUpdateListener(this.onMediaStatusUpdate.bind(this));

        //this.currentMediaDuration = this.currentMediaSession.media.duration;
        //var duration = this.currentMediaDuration;
        //var hr = parseInt(duration / 3600);
        //duration -= hr * 3600;
        //var min = parseInt(duration / 60);
        //var sec = parseInt(duration % 60);
        //if (hr > 0) {
        //    duration = hr + ":" + min + ":" + sec;
        //}
        //else {
        //    if (min > 0) {
        //        duration = min + ":" + sec;
        //    }
        //    else {
        //        duration = sec;
        //    }
        //}
        //document.getElementById("duration").innerHTML = duration;

        //if (this.localPlayerState == PLAYER_STATE.PLAYING) {
        //    this.localPlayerState == PLAYER_STATE.STOPPED;
        //    var vi = document.getElementById('video_image')
        //    vi.style.display = 'block';
        //    this.localPlayer.style.display = 'none';
        //    // start progress timer
        //    this.startProgressTimer(this.incrementMediaTime);
        //}
        //// update UIs
        //this.updateMediaControlUI();
        //this.updateDisplayMessage();
    };

    /**
     * Callback function when media load returns error 
     */
    CastPlayer.prototype.onLoadMediaError = function (e) {
        console.log("media error");
        this.castPlayerState = PLAYER_STATE.IDLE;
    };

    /**
     * Callback function for media status update from receiver
     * @param {!Boolean} e true/false
     */
    CastPlayer.prototype.onMediaStatusUpdate = function (e) {
        if (e == false) {
            this.currentMediaTime = 0;
            this.castPlayerState = PLAYER_STATE.IDLE;
        }
        console.log("updating media");
        //this.updateProgressBar(e);
    };

    /**
     * Helper function
     * Increment media current position by 1 second 
     */
    CastPlayer.prototype.incrementMediaTime = function () {
        if (this.castPlayerState == PLAYER_STATE.PLAYING) {
            if (this.currentMediaTime < this.currentMediaDuration) {
                this.currentMediaTime += 1;
                this.updateProgressBarByTimer();
            }
            else {
                this.currentMediaTime = 0;
                clearInterval(this.timer);
            }
        }
    };

    /**
     * Play media in Cast mode 
     */
    CastPlayer.prototype.playMedia = function () {
        
        if (!this.currentMediaSession) {
            return;
        }

        switch (this.castPlayerState) {
            case PLAYER_STATE.LOADED:
            case PLAYER_STATE.PAUSED:
                this.currentMediaSession.play(null,
                  this.mediaCommandSuccessCallback.bind(this, "playing started for " + this.currentMediaSession.sessionId),
                  this.onError.bind(this));
                this.currentMediaSession.addUpdateListener(this.onMediaStatusUpdate.bind(this));
                this.castPlayerState = PLAYER_STATE.PLAYING;
                // start progress timer
                this.startProgressTimer(this.incrementMediaTime);
                break;
            case PLAYER_STATE.IDLE:
            case PLAYER_STATE.LOADING:
            case PLAYER_STATE.STOPPED:
                this.loadMedia(this.currentMediaIndex);
                this.currentMediaSession.addUpdateListener(this.onMediaStatusUpdate.bind(this));
                this.castPlayerState = PLAYER_STATE.PLAYING;
                break;
            default:
                break;
        }
    };

    /**
     * Pause media playback in Cast mode  
     */
    CastPlayer.prototype.pauseMedia = function () {
        
        if (!this.currentMediaSession) {
            return;
        }

        if (this.castPlayerState == PLAYER_STATE.PLAYING) {
            this.castPlayerState = PLAYER_STATE.PAUSED;
            this.currentMediaSession.pause(null,
              this.mediaCommandSuccessCallback.bind(this, "paused " + this.currentMediaSession.sessionId),
              this.onError.bind(this));
            clearInterval(this.timer);
        }
    };

    /**
     * Stop CC playback 
     */
    CastPlayer.prototype.stopMedia = function () {
        
        if (!this.currentMediaSession) {
            return;
        }

        this.currentMediaSession.stop(null,
          this.mediaCommandSuccessCallback.bind(this, "stopped " + this.currentMediaSession.sessionId),
          this.onError.bind(this));
        this.castPlayerState = PLAYER_STATE.STOPPED;
        clearInterval(this.timer);
    };

    /**
     * Set media volume in Cast mode
     * @param {Boolean} mute A boolean  
     */
    CastPlayer.prototype.setReceiverVolume = function (mute) {
        
        if (!this.currentMediaSession) {
            return;
        }

        if (!mute) {
            this.session.setReceiverVolumeLevel(1,
              this.mediaCommandSuccessCallback.bind(this),
              this.onError.bind(this));
        }
        else {
            this.session.setReceiverMuted(true,
              this.mediaCommandSuccessCallback.bind(this),
              this.onError.bind(this));
        }
    };

    /**
     * Toggle mute CC
     */
    CastPlayer.prototype.toggleMute = function () {
        if (this.audio == true) {
            this.mute();
        }
        else {
            this.unMute();
        }
    };

    /**
     * Mute CC
     */
    CastPlayer.prototype.mute = function () {
        this.audio = false;
        this.setReceiverVolume(true);
    };

    /**
     * Unmute CC
     */
    CastPlayer.prototype.unMute = function () {
        this.audio = true;
        this.setReceiverVolume(false);
    };


    /**
     * media seek function in either Cast or local mode
     * @param {Event} e An event object from seek 
     */
    CastPlayer.prototype.seekMedia = function (event) {
        var pos = parseInt(event.offsetX);
        var pi = document.getElementById("progress_indicator");
        var p = document.getElementById("progress");
        if (event.currentTarget.id == 'progress_indicator') {
            var curr = parseInt(this.currentMediaTime + this.currentMediaDuration * pos / PROGRESS_BAR_WIDTH);
            var pp = parseInt(pi.style.marginLeft) + pos;
            var pw = parseInt(p.style.width) + pos;
        }
        else {
            var curr = parseInt(pos * this.currentMediaDuration / PROGRESS_BAR_WIDTH);
            var pp = pos - 21 - PROGRESS_BAR_WIDTH;
            var pw = pos;
        }

        if (this.localPlayerState == PLAYER_STATE.PLAYING || this.localPlayerState == PLAYER_STATE.PAUSED) {
            this.localPlayer.currentTime = curr;
            this.currentMediaTime = curr;
            this.localPlayer.play();
        }

        if (this.localPlayerState == PLAYER_STATE.PLAYING || this.localPlayerState == PLAYER_STATE.PAUSED
            || this.castPlayerState == PLAYER_STATE.PLAYING || this.castPlayerState == PLAYER_STATE.PAUSED) {
            p.style.width = pw + 'px';
            pi.style.marginLeft = pp + 'px';
        }

        if (this.castPlayerState != PLAYER_STATE.PLAYING && this.castPlayerState != PLAYER_STATE.PAUSED) {
            return;
        }

        this.currentMediaTime = curr;
        console.log('Seeking ' + this.currentMediaSession.sessionId + ':' +
          this.currentMediaSession.mediaSessionId + ' to ' + pos + "%");
        var request = new chrome.cast.media.SeekRequest();
        request.currentTime = this.currentMediaTime;
        this.currentMediaSession.seek(request,
          this.onSeekSuccess.bind(this, 'media seek done'),
          this.onError.bind(this));
        this.castPlayerState = PLAYER_STATE.SEEKING;
    };

    /**
     * Callback function for seek success
     * @param {String} info A string that describe seek event
     */
    CastPlayer.prototype.onSeekSuccess = function (info) {
        console.log(info);
        this.castPlayerState = PLAYER_STATE.PLAYING;
    };

    /**
     * Callback function for media command success 
     */
    CastPlayer.prototype.mediaCommandSuccessCallback = function (info, e) {
        console.log(info);
    };

    /**
     * Update progress bar when there is a media status update
     * @param {Object} e An media status update object 
     */
    CastPlayer.prototype.updateProgressBar = function (e) {
        var p = document.getElementById("progress");
        var pi = document.getElementById("progress_indicator");
        if (e.idleReason == 'FINISHED' && e.playerState == 'IDLE') {
            p.style.width = '0px';
            pi.style.marginLeft = -21 - PROGRESS_BAR_WIDTH + 'px';
            clearInterval(this.timer);
            this.castPlayerState = PLAYER_STATE.STOPPED;
        }
        else {
            p.style.width = Math.ceil(PROGRESS_BAR_WIDTH * e.currentTime / this.currentMediaSession.media.duration + 1) + 'px';
            this.progressFlag = false;
            setTimeout(this.setProgressFlag.bind(this), 1000); // don't update progress in 1 second
            var pp = Math.ceil(PROGRESS_BAR_WIDTH * e.currentTime / this.currentMediaSession.media.duration);
            pi.style.marginLeft = -21 - PROGRESS_BAR_WIDTH + pp + 'px';
        }
    };

    /**
     * Set progressFlag with a timeout of 1 second to avoid UI update
     * until a media status update from receiver 
     */
    CastPlayer.prototype.setProgressFlag = function () {
        this.progressFlag = true;
    };

    /**
     * Update progress bar based on timer  
     */
    CastPlayer.prototype.updateProgressBarByTimer = function () {
        var p = document.getElementById("progress");
        if (isNaN(parseInt(p.style.width))) {
            p.style.width = 0;
        }
        if (this.currentMediaDuration > 0) {
            var pp = Math.floor(PROGRESS_BAR_WIDTH * this.currentMediaTime / this.currentMediaDuration);
        }

        if (this.progressFlag) {
            // don't update progress if it's been updated on media status update event
            p.style.width = pp + 'px';
            var pi = document.getElementById("progress_indicator");
            pi.style.marginLeft = -21 - PROGRESS_BAR_WIDTH + pp + 'px';
        }

        if (pp > PROGRESS_BAR_WIDTH) {
            clearInterval(this.timer);
            this.deviceState = DEVICE_STATE.IDLE;
            this.castPlayerState = PLAYER_STATE.IDLE;
        }
    };

    var castPlayer = new CastPlayer();

    window.CastPlayer = castPlayer;
    
    function chromecastPlayer() {

        var self = this;

        self.name = 'Chromecast';

        self.play = function (options) {

        };

        self.shuffle = function (id) {

        };

        self.instantMix = function (id) {

        };

        self.queue = function (options) {

        };

        self.queueNext = function (options) {

        };

        self.stop = function () {
            CastPlayer.stop();
        };

        self.canQueueMediaType = function (mediaType) {

            return false;
        };

        self.mute = function() {
            CastPlayer.mute();
        };

        self.unMute = function () {
            CastPlayer.unMute();
        };

        self.toggleMute = function () {
            CastPlayer.toggleMute();
        };

        self.getTargets = function () {

            var targets = [];

            var appName = null;
            
            //if (CastPlayer.session && CastPlayer.session.receiver && CastPlayer.session.friendlyName) {
            //    appName = CastPlayer.session.friendlyName;
            //}

            //if (true) {
            //    targets.push({
            //        name: "Chromecast",
            //        id: "Chromecast",
            //        playerName: self.name,
            //        playableMediaTypes: ["Audio", "Video"],
            //        isLocalPlayer: false,
            //        appName: appName
            //    });
            //}

            return targets;
        };
    }

    MediaController.registerPlayer(new chromecastPlayer());

    $(document).on('headercreated', ".libraryPage", function () {

        var page = this;

        //castPlayer.updateMediaControlUI();

    });

    $(MediaController).on('playerchange', function () {

        if (MediaController.getPlayerInfo().name == 'Chromecast') {
            window.CastPlayer.launchApp();
        }
    });

})(window, window.chrome, console);