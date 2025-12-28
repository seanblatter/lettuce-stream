const { google } = require('googleapis');

class BroadcastOrchestrator {
  constructor({ db, decrypt, userId }) {
    this.db = db;
    this.decrypt = decrypt;
    this.userId = userId;
  }

  async goLive({ title, destinations, manualTargets = [] }) {
    const platformTokens = await this.loadDestinations(destinations);
    const sessions = await this.prepareSessions({ title, platformTokens, manualTargets });
    const ingestTargets = this.buildIngestTargets(sessions, manualTargets);
    return { sessions, ingestTargets };
  }

  async loadDestinations(destinations) {
    const snapshot = await this.db
      .collection('users')
      .doc(this.userId)
      .collection('destinations')
      .get();
    const tokens = {};
    snapshot.forEach((doc) => {
      if (destinations.length === 0 || destinations.includes(doc.id)) {
        tokens[doc.id] = { ...doc.data(), decrypted: this.decrypt(doc.data().tokens) };
      }
    });
    return tokens;
  }

  async prepareSessions({ title, platformTokens, manualTargets }) {
    const sessions = [];

    if (platformTokens.youtube) {
      const session = await this.prepareYouTubeSession(title, platformTokens.youtube);
      sessions.push(session);
    }

    if (platformTokens.twitch) {
      const session = await this.prepareTwitchSession(platformTokens.twitch);
      sessions.push(session);
    }

    manualTargets.forEach((target) => {
      sessions.push({ platform: 'custom', target });
    });

    return sessions;
  }

  async prepareYouTubeSession(title, connection) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: connection.decrypted?.accessToken,
      refresh_token: connection.decrypted?.refreshToken,
      expiry_date: connection.decrypted?.expiry
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const broadcast = await youtube.liveBroadcasts.insert({
      part: ['snippet', 'status', 'contentDetails'],
      requestBody: {
        snippet: { title, scheduledStartTime: new Date().toISOString() },
        status: { privacyStatus: 'public' }
      }
    });

    const stream = await youtube.liveStreams.insert({
      part: ['snippet', 'cdn'],
      requestBody: {
        snippet: { title: `${title} stream` },
        cdn: { format: '1080p', ingestionType: 'rtmp' }
      }
    });

    await youtube.liveBroadcasts.bind({
      id: broadcast.data.id,
      streamId: stream.data.id,
      part: ['id', 'snippet', 'status']
    });

    return {
      platform: 'youtube',
      broadcastId: broadcast.data.id,
      ingestionAddress: stream.data.cdn?.ingestionInfo?.ingestionAddress,
      streamName: stream.data.cdn?.ingestionInfo?.streamName
    };
  }

  async prepareTwitchSession(connection) {
    const streamKey = connection.channel?.streamKey || connection.decrypted?.streamKey;
    const ingest = 'rtmp://live.twitch.tv/app';
    return {
      platform: 'twitch',
      ingestionAddress: ingest,
      streamName: streamKey
    };
  }

  buildIngestTargets(sessions, manualTargets) {
    const ingestTargets = sessions
      .filter((session) => session.ingestionAddress)
      .map((session) => ({
        platform: session.platform,
        url: `${session.ingestionAddress}/${session.streamName}`,
        broadcastId: session.broadcastId || null
      }));

    manualTargets.forEach((target) => {
      ingestTargets.push({ platform: 'custom', url: target.url, streamKey: target.streamKey });
    });

    return ingestTargets;
  }
}

module.exports = { BroadcastOrchestrator };
