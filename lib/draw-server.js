var https = require('https');
var express = require('express');
var fs = require('fs');
var config = require('../config');
var path = require('path');
var Canvas = require('canvas')
  , canvas = new Canvas(1500,1500)
  , ctx = canvas.getContext('2d');

try {
	var old_image = new Canvas.Image;
	old_image.src = "../public/draw.jpg";
	ctx.drawImage(old_image, 0, 0);
} catch (e) {
	console.log(e);
}

var root = path.join(__dirname, '..');
var salt_file = path.join(root, config.salt_file);
var ca_file = path.join(root, config.ssl.ca);
var key_file = path.join(root, config.ssl.key);
var cert_file = path.join(root, config.ssl.cert);

var app = express();
var port = 5000;

var secure_server;
    var options = {
        ca:   fs.readFileSync(ca_file),
        key:  fs.readFileSync(key_file),
        cert: fs.readFileSync(cert_file)
    };
    secure_server = https.createServer(options, app).listen(port, function() {
        console.log('Express secure_server listening on port %d',
                    secure_server.address().port);
    });

var io = require('socket.io').listen(secure_server);

var max_length = 5000;
var curr_image = "";
var image_size = 200.0;
var user_dict = {};
var max_quota = 8000;
var quota_interval = 100;

function draw_pt(p) {
    ctx.beginPath();
    ctx.moveTo(p.prevX, p.prevY);
    ctx.lineTo(p.currX, p.currY);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.closePath();
}

function draw_char(c, color) {
	var text_width = c.c.length * 14.45;
	ctx.fillStyle = "#FFFFFF";
	ctx.fillRect(c.currTextX, c.currTextY+5, text_width, -23);
    ctx.font = 'bold 18pt Courier';
    ctx.fillStyle = color ? color : 'black';
    if (c.c[0] == ">")
    	ctx.fillStyle = 'green';
    ctx.fillText(c.c, c.currTextX, c.currTextY);
}

function draw_image(image_data) {
	var load_image = new Canvas.Image();
    load_image.src = image_data.src;
	var scale_factor = load_image.height > load_image.width ? image_size/load_image.height : image_size/load_image.width;
	ctx.drawImage(load_image, image_data.x, image_data.y,
  				scale_factor*load_image.width,
  				scale_factor*load_image.height);  
}

var flag = false
function check_quota(cost, id) {
	var gain = (Date.now() - user_dict[id][0]) * 5;
	gain = gain > max_quota ? max_quota : gain;
	if (user_dict[id][1] - cost + gain <= 0) {
		delete user_dict[id];
		user_dict[id] = [Date.now(), 0];
		return false;
	} else {
		user_dict[id][1] -= cost;
		user_dict[id][0] = Date.now();
	}
	return true;
}
function draw_canvas(data, socket){
	var can_send = true;
	for (i in data) {
		if (data[i] && data[i].type){
		try {
		switch (data[i].type) {
			case "word":
				if (can_send = check_quota(100*data[i].c.length, socket.id))
					draw_char(data[i]);
				break;
			case "stroke":
				var size = Math.abs(data[i].prevX-data[i].currX)+Math.abs(data[i].prevY-data[i].currY)
				if (can_send = check_quota(size, socket.id))
					draw_pt(data[i]);
				break;
			case "image":
				if (user_dict[socket.id][0] + 10000 < Date.now()){
					draw_image(data[i]);
					user_dict[socket.id][0] = Date.now();
				} else {
					console.log("too soon!");
					return;
				}
					
				break;
		}} catch(e) {
			console.log(e);
		}
		}
	}
	if (can_send) {
		socket.broadcast.emit('server', data);
	} else {
		console.log("limit was reached on id: ", socket.id);
	}
	flag = true;
}

function draw_to_binary(){
		if (!flag) {
            setTimeout(draw_to_binary,5000);
			return;
        }
		ctx.fillStyle = "rgba(255,255,255,"+0.02+")";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		curr_image = canvas.toDataURL();
		
		function decodeBase64Image(dataString) {
		  var matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/),
		    response = {};
		
		  if (matches.length !== 3) {
		    return new Error('Invalid input string');
		  }
		
		  response.type = matches[1];
		  response.data = new Buffer(matches[2], 'base64');
		
		  return response;
		}
		var imageBuffer = decodeBase64Image(curr_image);
		
		fs.writeFile("../public/draw.jpg", imageBuffer.data, function(err) {
		    if(err) {
		        console.log(err);
		    } else {
		        //console.log("The file was saved!");
		        setTimeout(draw_to_binary,10000);
            }
		}); 
		flag = false;
}

//setInterval(draw_to_binary, 5000); // refreshes the image and dims it
draw_to_binary();

io.set('log level', 1);
io.sockets.on('connection', function (socket) {
  //socket.emit('init_draw', {image: curr_image});
  user_dict[socket.id] = [Date.now(), max_quota];
  console.log("User joined for a total of %d", io.sockets.clients().length);
  socket.on('client', function (data) {
    try {
    	draw_canvas(data, socket);
    } catch (e) {
	    console.log(e);
    }
  });
  socket.on('disconnect', function(){
	  delete user_dict[socket.id];
  })
});
