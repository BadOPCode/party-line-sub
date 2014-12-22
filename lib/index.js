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

    /**
     *  Outputs a single packet to stdout stream.
     *  Defined inside of block because function is needed immediately.
     */
    self.send = function(transmit_packet) {
        console.log(JSON.stringify(transmit_packet));
    };
}

var partylinesub = module.exports = exports = new PartyLineSub;

/**
 * Sends to the bus what contexts this subsystem wants to listen to.
 * Accepts no parameters because the context should be set to
 * self.listen_context array.
 */
PartyLineSub.prototype.sendSetListenerContext = function(){
    var self = this;
    var setContextPacket = {
        context: "bus",
        type: "setListenContext",
        listen_context: self.listen_context
    };
    self.send(setContextPacket);
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
    
    self.listen_context.forEach(function(context){
       if (context != delete_context) {
           new_context_stack.push(context);
       } 
    });
    
    self.listen_context = new_context_stack;
    self.sendSetListenerContext();
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
partylinesub.input_stream.on("data",function(packet){
    var self = partylinesub;
    
    //check if packet has context and if its for this sub
    if (typeof(packet.context) == 'undefined' || !packet.context.match(self.listen_context)) {
        return; //packet is not for this service
    }
    
    //send this packet to calling application
    self.packet_handlers.forEach(function(packet_handler){
       if (packet.type == packet_handler.packet_type) {
           packet_handler.cb_packet_handler(packet);
       }
    });
});

/**
 * A general catch for when something goes wrong in the down stream and 
 * sends a message to the upstream.
 */
partylinesub.input_stream.on("error", function(err){
    var error_packet = {
        type: 'error',
        data: err
    };
    partylinesub.send(error_packet);
});
