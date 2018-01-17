const WebSocket = require('ws');
const Discord = require('discord.js');
const fs = require('fs');

function readJSON(filename) {
	return JSON.parse(fs.readFileSync(filename, 'utf8'));
}
function writeJSON (filename, data) {
	return fs.writeFileSync(filename, JSON.stringify(data), 'utf8');
}
function send(data, ws) {
	ws.send(JSON.stringify(data));
}

let Config = readJSON(__dirname + '/JSON/config.json');
// <user id>: <number>
let Perms = readJSON(__dirname + '/JSON/approved.json');
// <channel id>: <hc-room-string>
let Rooms = readJSON(__dirname + '/JSON/rooms.json');
let wsRooms = {};

const Client = new Discord.Client();


function joinRoom (id) {
	let room = Rooms[id];

	if (!room) return false;

	wsRooms[id] = {
		ws: new WebSocket('wss://hack.chat/chat-ws'),
		nick: 'Discord' + Math.floor(Math.random() * 1000),
		id,
		channel: room,
		interval: setInterval(p => send({cmd:'ping'}, wsRooms[id].ws), 50*1000)
	}
	wsRooms[id].ws.__parent = wsRooms[id];
	wsRooms[id].ws.on('open', function () {
		send({
			cmd: 'join',
			nick: wsRooms[id].nick,
			channel: wsRooms[id].channel
		}, wsRooms[id].ws);
	});
	wsRooms[id].ws.on('error', function () {
		ws.close();
	});
	wsRooms[id].ws.on('close', function () {
		if (wsRooms[id]) { // if it still exists
			wsRooms[id].ws.close();
			setTimeout(p => {
				delete wsRooms[id];
				joinRoom(id);
			}, 1000);
		}
	});
	wsRooms[id].ws.on('message', function (data) {
try {
		data = JSON.parse(data);
		
		if (data.nick === wsRooms[id].nick) {
			return; // ignore itself
		}

		let channel = Client.channels.find('id', wsRooms[id].id);

		let embed = {
			description: "",
			color: 0x6684e1, // light blue
			//timestamp: data.time,
			author: {
			  name: ""
			}
		};
		console.log(data);

		let serverColor = 0x60AC39; //0xAF5BA6;
		let warnColor = 0xCFB017;
		let modColor = 0x1FAD83;
		let adminColor = 0xD73737;

		if (data.cmd === 'onlineSet') {
			embed.author.name = "!SERVER!";
			embed.description = "Connected\n***Online Users: " + data.nicks.join(', ') + '***.';
			embed.color = serverColor;
		} else if (data.cmd === 'onlineAdd') {
			embed.author.name = "!SERVER!";
			embed.description = data.nick + ' joined the room.';
			embed.color = serverColor;
		} else if (data.cmd === 'onlineRemove') {
			embed.author.name = "!SERVER!";
			embed.description = data.nick + ' left the room';
			embed.color = serverColor;
		} else if (data.cmd === 'warn') {
			embed.author.name = "!SERVER WARNING!";
			embed.description = "SERVER ISSUED A WARNING:\n" + data.text;
			embed.color = warnColor;
		} else if (data.cmd === 'info') {
			embed.author.name = "!SERVER INFO!";
			embed.description = data.text;
			embed.color = serverColor;
		} else if (data.cmd === 'chat') {
			if (data.mod) {
				embed.color = modColor;
			}

			if (data.admin) {
				embed.color = adminColor;
			}

			embed.author.name = data.nick;

			if (data.trip) {
				embed.author.name += '#' + data.trip;
			}

			embed.description = data.text;

			if (embed.description.length >= 1900) {
				embed.description = embed.description.slice(0, 1900) + ' ... Message was too long.'; // shortens it
			}
		}
		if (channel) {
			channel.send({embed})
				.catch((...args) => {
					console.error(...args);
					send({cmd:'chat', text: 'There was an error in putting the message to discord:' + err}, wsRooms[id].ws);
				});
		}
} catch (err) {
	send({cmd:'chat', text: 'There was an error in putting the message to discord:' + err}, wsRooms[id].ws);
}
	});
	return wsRooms[id];
}

// #region Commands
let Commands = [];
function addCommand (name, func, testFunc) {
	Commands.push({
		name,
		func,
		testFunc
	});
	return true;
}

function runCommand(message) {
	const commandName = message.content.replace(Config.botPrefix, '').split(' ')[0].toLowerCase();
	const command = Commands.filter(cmd => cmd.name === commandName)[0];

	if (!command) {
		return message.reply('That is not a command!');
	}

	let args = {
		message,
		reply: message.reply.bind(message),
		send: message.reply.bind(message),
		member: message.member,

		channel: message.channel,
		
		text: message.content,
		params: message.content.split(' ')
	};

	if (typeof(command.testFunc) === 'function' && !command.testFunc(args)) {
		return message.reply('You can not use that command!');
	}

	command.func(args);
}

addCommand('help', function (args) {
	args.send('Help:\n' + Commands.filter(command => args.testFunc === undefined ? true : args.testFunc(args)).map(command => command.name).join(', ') + '.');
});

addCommand('anon', function (args) {
	send({
		cmd: 'chat',
		text: args.params.slice(1).join(' ')
	}, wsRooms[args.channel.id].ws);
});

addCommand('disconnect', function (args) {
	if (!Rooms[args.channel.id]) {
		return args.reply('There is no hack.chat room connected with this.');
	}

	delete Rooms[args.channel.id];

	wsRooms[args.channel.id].ws.close();
	clearInterval(wsRooms[args.channel.id].interval);
	delete wsRooms[args.channel.id];
	
	writeJSON(__dirname + '/JSON/rooms.json', Rooms);

	return args.reply('Disconnected from that room.');
}, function (args) {
	return Perms[args.member.id] === 5000; // 5000 is minusgix
})

addCommand('connect', function (args) {
	let channel = args.params[1];
	if (!channel) {
		return args.reply('You have to supply a room to join.');
	}

	if (Rooms[args.channel.id]) {
		return args.reply('A hack.chat room is already connected with this channel.');
	}
	
	// ?botDev is different than ?BOTDEV
	for (let i in Rooms) {
		if (Rooms[i] === channel) {
			return args.reply('There is already a channel connected to that hack.chat room.');
		}
	}

	Rooms[args.channel.id] = channel;
	writeJSON(__dirname + '/JSON/rooms.json', Rooms);
	joinRoom(args.channel.id);
	return args.reply('Successfully connected the channel.');
}, function (args) {
	return Perms[args.member.id] === 5000; // 5000 is minusgix
});
addCommand('connectedchannels', function (args) {
	let channel = Rooms[args.channel.id];

	if (channel) {
		return args.reply('The hack.chat room ?' + channel + ' is connected with this channel.');
	} else {
		return args.reply('There is no hack.chat rooms connected with this channel.');
	}
});
addCommand('setperms', function (args) {
	let user = args.message.mentions.members.array()[0];

	if (!user) {
		return args.reply('You have to have to mention a user to do that.');
	}

	if (Number.isNaN(args.params[2])) {
		return args.reply('You have to supply the new permission level of the user.');
	}

	Perms[user.id] = Number(args.params[2]);
	return args.reply('That user has been given a perm level of: ' + args.params[2]);
}, function (args) {
	return Perms[args.member.id] === 5000; // 5000 is minusgix
});

// #endregion Commands

Client.on('ready', function () {
	for (let i in Rooms) {
		joinRoom(i);
	}
	console.log('Logged in...');
});

Client.on('message', function (message) {
	if (message.channel.type === "text") { // guild text channel
		if (message.author.id === Client.user.id) {
			return; // ignore self
		}
		if (message.content.startsWith(Config.botPrefix)) { // it's a command, yo
			return runCommand(message);
		}

		if (Rooms[message.channel.id]) {
			if (wsRooms[message.channel.id]) {
				let text = ' ' + (message.member.nickname || message.author.username) + '#' + message.author.discriminator + ': ';
				let content = message.content;
			
				let members = message.mentions.members.array();
				for (let i = 0; i < members.length; i++) {
					let reg = new RegExp('\\<\\@' + members[i].id + '\\>', 'g');
					content = content.replace(reg, '@' + (members[i].nickname || members[i].user.username));
				}
				text += content;

				send({
					cmd: 'chat',
					text
				}, wsRooms[message.channel.id].ws);
			}
		}
	}
});



Client.login(Config.botToken);