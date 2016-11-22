var Noble = require('noble');
var Service, Characteristic;

var SUPERLIGHTS_SERVICE = "ffb0";
var SUPERLIGHTS_RGB_CHARACTERISTIC = "ffb2";

module.exports = function(homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;

	homebridge.registerAccessory("homebridge-superlights", "Superlight", SuperlightAccessory);
}

function SuperlightAccessory(log, config) {
	this.log = log;
	this.name = config["name"]
	this.address = config["address"]

	/**
	 * Initialise the HAP Lightbulb service and configure characteristic bindings
	 */
	this.lightService = new Service.Lightbulb(this.name);

	this.lightService
		.getCharacteristic(Characteristic.On) // BOOL
		.on('set', this.setPowerState.bind(this))
		.on('get', this.getPowerState.bind(this));

	this.lightService
		.addCharacteristic(new Characteristic.Brightness()) // INT (0-100)
		.on('set', this.setBrightness.bind(this))
		.on('get', this.getBrightness.bind(this));

	this.lightService
		.addCharacteristic(new Characteristic.Saturation()) // FLOAT (0-100)
		.on('set', this.setSaturation.bind(this))
		.on('get', this.getSaturation.bind(this));

	this.lightService
		.addCharacteristic(new Characteristic.Hue()) // FLOAT (0-360)
		.on('set', this.setHue.bind(this))
		.on('get', this.getHue.bind(this));

	/**
	 * Initialise the Noble service for talking to the bulb
	 **/
	this.nobleCharacteristic = null;
	Noble.on('stateChange', this.nobleStateChange.bind(this));
}

SuperlightAccessory.prototype.getServices = function() {
	return [this.lightService];
}

SuperlightAccessory.prototype.identify = function(callback) {
	this.log("[" + this.name + "] Identify requested!");
	// TODO: This could send a sequence of colour flashes to the bulb
	callback(null);
}

/**
 * Getters/setters for publicly exposed characteristics for the bulb
 **/
SuperlightAccessory.prototype.setPowerState = function(powerState, callback) {
	this.powerState = powerState;
	this.writeToBulb(function(){
		callback(null);
	});
}

SuperlightAccessory.prototype.setBrightness = function(value, callback) {
	this.brightness = value;
	this.writeToBulb(function(){
		callback(null);
	});
}

SuperlightAccessory.prototype.setSaturation = function(value, callback) {
	this.saturation = value;
	this.writeToBulb(function(){
		callback(null);
	});
}

SuperlightAccessory.prototype.setHue = function(value, callback) {
	this.hue = value;
	this.writeToBulb(function(){
		callback(null);
	});
}

SuperlightAccessory.prototype.getPowerState = function(callback) {
	this.readFromBulb(function(error) {
		callback(error, error ? null : this.powerState);
	});
}

SuperlightAccessory.prototype.getBrightness = function(callback) {
	this.readFromBulb(function(error) {
		callback(error, error ? null : this.brightness);
	});
}

SuperlightAccessory.prototype.getSaturation = function(callback) {
	this.readFromBulb(function(error) {
		callback(error, error ? null : this.saturation);
	});
}

SuperlightAccessory.prototype.getHue = function(callback) {
	this.readFromBulb(function(error) {
		callback(error, error ? null : this.hue);
	});
}


/**
 * Noble discovery callbacks
 **/
SuperlightAccessory.prototype.nobleStateChange = function(state) {
	if (state == "poweredOn") {
		this.log.info("Starting Noble scan..");
		Noble.startScanning([], false);
		Noble.on("discover", this.nobleDiscovered.bind(this));
	} else {
		Noble.stopScanning();
	}
}

SuperlightAccessory.prototype.nobleDiscovered = function(accessory) {
	if (accessory.address == this.address) {
		this.log.info("Found accessory for " + this.name + ", connecting..");
		accessory.connect(function(error){
			this.nobleConnected(error, accessory);
		}.bind(this));
	} else {
		this.log.info("Skipping non-matching accessory at " + accessory.address);
	}
}

SuperlightAccessory.prototype.nobleConnected = function(error, accessory) {
	if (error) {
		this.log.warn("Noble connection failed: " + error);
		return;
	}
	accessory.discoverServices([SUPERLIGHTS_SERVICE], this.nobleServicesDiscovered.bind(this));
	accessory.on('disconnect', function(error) {
		this.nobleDisconnected(error, accessory);
	}.bind(this));
}

SuperlightAccessory.prototype.nobleDisconnected = function(error, accessory) {
	this.log.info("Disconnected from " + accessory.address + ":" + error);
	accessory.removeAllListeners('disconnect');
}

SuperlightAccessory.prototype.nobleServicesDiscovered = function(error, services) {
	if (error) {
		this.log.warn("Noble service discovery failed: " + error);
		return;
	}
	for (var service of services) {
		service.discoverCharacteristics([], this.nobleCharacteristicsDiscovered.bind(this));
	}
}

SuperlightAccessory.prototype.nobleCharacteristicsDiscovered = function(error, characteristics) {
	if (error) {
		this.log.warn("Noble characteristic discovery failed: " + error);
		return;
	}
	for (var characteristic of characteristics) {
		if (characteristic.uuid == SUPERLIGHTS_RGB_CHARACTERISTIC) {
			this.log.info("Found RGB Characteristic: " + characteristic.uuid);
			this.nobleCharacteristic = characteristic;
			this.readFromBulb(function(error){
				this.log.info("Read initial values: " + this.hue + ", " + this.saturation + ", " + this.brightness);
			}.bind(this));
		}
	}
}


/**
 * Functions for interacting directly with the lightbulb's RGB property
 **/
SuperlightAccessory.prototype.readFromBulb = function(callback) {
	this.nobleCharacteristic.read(function(error, buffer) {
		if (error) {
			this.log.warn("Read from bluetooth characteristic failed | " + error);
			callback(error);
			return;
		}
		var r = buffer.readUInt8(1);
		var g = buffer.readUInt8(2);
		var b = buffer.readUInt8(3);

		this.log.info("Get | " + r + " " + g + " " + b);
		var hsv = this.rgb2hsv(r, g, b);
		this.hue = hsv.h;
		this.saturation = hsv.s;
		this.brightness = hsv.v;
		callback(null);
	}.bind(this))
}

SuperlightAccessory.prototype.writeToBulb = function(callback) {
	var rgb = this.hsv2rgb(this.hue, this.saturation, this.brightness);
	this.log.info("Set | "
		+ rgb.r + " " + rgb.g + " " + rgb.b
		+ " (" + this.powerState ? "On" : "Off" + ")");

	var buffer = Buffer.alloc(4);
	buffer.writeUInt8(0xD0, 0);
	buffer.writeUInt8(this.powerState ? rgb.r : 0, 1);
	buffer.writeUInt8(this.powerState ? rgb.g : 0, 2);
	buffer.writeUInt8(this.powerState ? rgb.b : 0, 3);
	this.nobleCharacteristic.write(buffer, false);
	callback();
}

// From http://stackoverflow.com/questions/8022885/rgb-to-hsv-color-in-javascript
SuperlightAccessory.prototype.rgb2hsv = function(r, g, b) {
  var rr, gg, bb,
      r = r / 255,
      g = g / 255,
      b = b / 255,
      h, s,
      v = Math.max(r, g, b),
      diff = v - Math.min(r, g, b),
      diffc = function(c){
          return (v - c) / 6 / diff + 1 / 2;
      };

  if (diff == 0) {
      h = s = 0;
  } else {
      s = diff / v;
      rr = diffc(r);
      gg = diffc(g);
      bb = diffc(b);

      if (r === v) {
          h = bb - gg;
      }else if (g === v) {
          h = (1 / 3) + rr - bb;
      }else if (b === v) {
          h = (2 / 3) + gg - rr;
      }
      if (h < 0) {
          h += 1;
      }else if (h > 1) {
          h -= 1;
      }
  }
  return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      v: Math.round(v * 100)
  };
}

// From https://gist.github.com/eyecatchup/9536706
SuperlightAccessory.prototype.hsv2rgb = function(h, s, v) {
    var r, g, b;
    var i;
    var f, p, q, t;
     
    // Make sure our arguments stay in-range
    h = Math.max(0, Math.min(360, h));
    s = Math.max(0, Math.min(100, s));
    v = Math.max(0, Math.min(100, v));
     
    // We accept saturation and value arguments from 0 to 100 because that's
    // how Photoshop represents those values. Internally, however, the
    // saturation and value are calculated from a range of 0 to 1. We make
    // That conversion here.
    s /= 100;
    v /= 100;
     
    if(s == 0) {
        // Achromatic (grey)
        r = g = b = v;
        return {
            r: Math.round(r * 255), 
            g: Math.round(g * 255), 
            b: Math.round(b * 255)
        };
    }
     
    h /= 60; // sector 0 to 5
    i = Math.floor(h);
    f = h - i; // factorial part of h
    p = v * (1 - s);
    q = v * (1 - s * f);
    t = v * (1 - s * (1 - f));
     
    switch(i) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        default: r = v; g = p; b = q;
    }
     
    return {
        r: Math.round(r * 255), 
        g: Math.round(g * 255), 
        b: Math.round(b * 255)
    };
}
