'use strict';
/**
 *  index.js - Shawn Rapp 2014-10-10
 *  Party Line subsystem interface library file.
 *  @author Shawn Rapp
 *  @version 1.0.0
 *  @license MIT. Read LICENSE for more information.
 *  @fileOverview Main library file.
 */

/**
 * Module dependencies.
 */

/**
 * Constructor for PartyLineSub
 */
function PartyLineSub() {
    var self = this;

    self.worker_id = "";
    self.bus_id = "";
    self.listen_context = [];
    self.packet_handlers = [];
    self.input_stream = require('JSONStream').parse();
    process.stdin.pipe(self.input_stream);
    self.outbound_packets = [];
    self.sending_state = false;

    self.logger = require('winston');
    self.logger.add(self.logger.transports.File, {
        filename: __dirname + '/../../../pl-sub.log'
    });
    self.logger.remove(self.logger.transports.Console);

    /**
     *  Outputs a single packet to stdout stream.
     *  Defined inside of block because function is needed immediately.
     */
    self.send = function(transmit_packet) {
        self.outbound_packets.push(transmit_packet);

        //already running send in a different thread.
        if (self.sending_state) return;

        //set state high this thread is going to send.
        self.sending_state = true;

        //keep sending till we run out of packets
        while (self.outbound_packets.length > 0) {
            var packet = self.outbound_packets.pop();
            console.log(JSON.stringify(packet));
        }

        //set state low this thread is finished.
        self.sending_state = false;
    };
    self.logger.info("Initialization complete.");
}

var partylinesub = module.exports = exports = new PartyLineSub;
partylinesub.send({
    context: "bus",
    type: "whoAmI"
});

/**
 * Sends to the bus what contexts this subsystem wants to listen to.
 * Accepts no parameters because the context should be set to
 * self.listen_context array.
 */
PartyLineSub.prototype.sendSetListenerContext = function() {
    var self = this;
    var setContextPacket = {
        context: "bus",
        type: "setListenContext",
        listen_context: self.listen_context
    };
    self.send(setContextPacket);
    self.logger.info("Setting listener to " + self.listen_context.toString());
};

/**
 * Adds a context this sub wants to listen on in the stack and sends the stack
 * to the bus.
 */
PartyLineSub.prototype.addListeningContext = function(new_context) {
    var self = this;

    self.listen_context.push(new_context);
    self.sendSetListenerContext();
};

/**
 * Removes the specified listening context from the stack of listening and sends
 * the results to the bus.
 */
PartyLineSub.prototype.removeListeningContext = function(delete_context) {
    var self = this;

    var new_context_stack = [];

    self.listen_context.forEach(function(context) {
        if (context != delete_context) {
            new_context_stack.push(context);
        }
    });

    self.listen_context = new_context_stack;
    self.sendSetListenerContext();
};

PartyLineSub.prototype.matchContext = function(match_context, callback) {
    var self = this;
    var matchFound = false;
    
    if (typeof(match_context) == "undefined") {
        callback(false);
        return;
    }
    
    //this is a direct addressed packet
    if (match_context == self.worker_id) {
        callback(true);
        return;
    }

    var reg_pat = new RegExp("^" + match_context + ".*");
    if (typeof self.listen_context == "string") {
        if (self.listen_context.match(reg_pat)) {
            callback(true);
        } else {
            callback(false);
        }
    }
    else {
        var found_match = false;

        self.listen_context.forEach(function(context) {
            if (context.match(reg_pat)) {
                found_match = true;
                return found_match;
            }
        });
        callback(found_match);
    }
};

PartyLineSub.prototype.queryService = function(query_context, cb_Results) {
    var self = this;

    var sap_packet = {
        context: "bus",
        type: "sapQuery",
        service_context: "web.html",
    };

    self.send(sap_packet);

    self.on("serviceList", function(packet) {
        self.logger.info("Recieved Service List");
        cb_Results(packet.serviceList);
    });
};


/**
 * allows developers to attach functions to packets based on packet
 * type.
 * More than one function can be attached to the same "event"
 */
PartyLineSub.prototype.on = function(packet_type, cb_packet_handler) {
    var self = this;

    var new_handler = {
        packet_type: packet_type,
        cb_packet_handler: cb_packet_handler
    };
    self.packet_handlers.push(new_handler);
};

/**
 * Process incoming JSON data looking for packets.
 */
// partylinesub.input_stream.on("data", function(packet) {
//     var self = partylinesub;

//     //check if packet has context and if its for this sub
//     self.matchContext(packet.context, function(matches) {
//         if (!matches) {
//             return;
//         }
//     });

//     //messages coming down from the bus
//     if (packet.from == "bus") {
//         switch (packet.type) {
//             case "youAre":
//                 self.bus_id = packet.bus_id;
//                 self.worker_id = packet.worker_id;
//                 break;
//         }
//     }

//     //send this packet to calling application
//     self.packet_handlers.forEach(function(packet_handler) {
//         if (packet.type == packet_handler.packet_type) {
//             try {
//                 packet_handler.cb_packet_handler(packet);
//             }
//             catch (err) {
//                 self.logger.error("Packet Handler:" + err, {
//                     broken_packet: packet
//                 });
//             }
//         }
//     });
//     self.logger.info("From:" + packet.from + "  Context:" + packet.context + "  Type:" + packet.type);
// });
partylinesub.input_stream.on("data", function(packet) {
    var self = partylinesub;
    
    function processPackets() {
        //send this packet to calling application
        self.packet_handlers.forEach(function(packet_handler) {
            if (packet.type == packet_handler.packet_type) {
                try {
                    packet_handler.cb_packet_handler(packet);
                    self.logger.info("From:" + packet.from + "  Context:" + packet.context + "  Type:" + packet.type);
                }
                catch (err) {
                    self.logger.error("Packet Handler:" + err, {
                        broken_packet: packet
                    });
                }
            }
        });
    }

    //messages coming down from the bus
    if (packet.from === "bus") {
        switch (packet.type) {
            case "youAre":
                self.bus_id = packet.bus_id;
                self.worker_id = packet.worker_id;
                break;
        }
        processPackets();
    }
    else { //bus packets are exempt from context matches
        //check if packet has context and if its for this sub
        self.matchContext(packet.context, function(matches) {
            if (!matches) {
                //this error needs to be logged as the bus *NORMALLY* should match the rules of the sub.
                self.logger.error("Packet does not match context", packet);
            }
            else {
                processPackets();
            }
        });
    }
});


/**
 * A general catch for when something goes wrong in the down stream and
 * sends a message to the upstream.
 */
partylinesub.input_stream.on("error", function(err) {
    // Do we really want to send the error as a broadcast on the bus?
    // var error_packet = {
    //     type: 'error',
    //     data: err
    // };
    // partylinesub.send(error_packet);
    partylinesub.logger.error(err);
});

process.on('uncaughtException', function(err) {
    partylinesub.logger.error(err);
});

process.on('exit', function() {
    var packet = {
        type: "close",
        exit_level: 0,
    };
    partylinesub.send(packet);
    partylinesub.logger.info("Subsystem closed.");

    process.kill('SIGINT');
});
