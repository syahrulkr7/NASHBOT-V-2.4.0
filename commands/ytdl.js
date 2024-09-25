const axios = require('axios');
const fs = require('fs');
const request = require('request');

module.exports = {
    name: "ytdl",
    description: "Download and send a YouTube video in MP4 format",
    nashPrefix: true,
    version: "1.0.0",
    role: 0,
    cooldowns: 7,
    aliases: ["ytdl"],
    execute(api, event, args, prefix) {
        const { threadID, messageID } = event;
        const videoLink = args.join(" ");
        
        if (!videoLink) {
            return api.sendMessage("Please provide a valid YouTube link.", threadID, messageID);
        }

        const apiUrl = `https://api-nako-choru-production.up.railway.app/yt/mp4?link=${encodeURIComponent(videoLink)}`;
        
        axios.get(apiUrl)
            .then(response => {
                const videoData = response.data.mp4Link;
                
                if (!videoData) {
                    return api.sendMessage("Video not found.", threadID, messageID);
                }

                const downloadLink = videoData.downloadLink;
                const title = videoData.title;
                const description = videoData.description;

                // Download and send the video file
                const videoFileName = `yt_video_${Date.now()}.mp4`;
                request(downloadLink)
                    .pipe(fs.createWriteStream(videoFileName))
                    .on('close', () => {
                        const messageBody = 
                            `Title: ${title}\n` +
                            `Description: ${description}\n\n` +
                            `The video is being sent...`;

                        api.sendMessage({ body: messageBody }, threadID, () => {
                            api.sendMessage(
                                { attachment: fs.createReadStream(videoFileName) },
                                threadID,
                                () => {
                                    fs.unlinkSync(videoFileName); // Clean up video file after sending
                                }
                            );
                        });
                    });
            })
            .catch(error => {
                console.error(error);
                api.sendMessage("There was an error fetching the video.", threadID, messageID);
            });
    }
};
