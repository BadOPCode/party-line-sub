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
    self.logger.add(self.logger.transports.File, {filename: __dirname+'/../../../pl-sub.log'});
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
        while(self.outbound_packets.length > 0) {
            var packet = self.outbound_packets.pop();
            console.log(JSON.stringify(packet));
        }
        
        //set state low this thread is finished.
        self.sending_state = false;
    };
    self.logger.info("Initialization complete.");
    
    
}

var partylinesub = module.exports = exports = new PartyLineSub;
partylinesub.send({context:"bus", type:"whoAmI"});

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
    self.logger.info("Setting listener to "+self.listen_context.toString());
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

PartyLineSub.prototype.queryService = function(query_context, cb_Results) {
    var self = this;
    
    var sap_packet = {
        context: "bus",
        type: "sapQuery",
        service_context: "web.html",
    };
    
    self.send(sap_packet);
    
    self.on("serviceList", function(packet){
        self.logger.info("Recieved Service List");
        cb_Results(packet.serviceList);
    });
};

/**
 * used to transmit large files accross the bus.
 *  !!! Killed because it was too unstable !!!
 */
// PartyLineSub.prototype.sendFile = function(fd, packet, stats) {
//     var self = this;
//     var fs = require('fs');
//     //size of each block
//     var block_size = 1024;
//     //total number of blocks including ending partial
//     var total_blocks = Math.floor(stats.size / block_size) + (block_size%stats.size?1:0);
//     var resend_blocks = [];
//     var quit_xfer = false;
    
//     function sendBlock(block_number) {
//         if (quit_xfer) return;  //abort if flag is high
        
//         var block_position = block_number * block_size;
//         var read_buffer = new Buffer(block_size);
//         var bytesRead = fs.readSync(fd, read_buffer, 0, block_size, block_position);
//         var file_packet = {
//             context: packet.from,
//             type: "blockLongTransfer",
//             block_number: current_block,
//             block_size: bytesRead,
//             data:read_buffer.toString('base64')
//         };
//         self.send(file_packet);
//     }
    
//     function resendBlocks() {
//         if (quit_xfer) {
//             //clear resend_blocks stack to try to prevent logic that would come back
//             resend_blocks = [];
//             return;
//         }
//         while (resend_blocks.length > 0) {
//             var block_number = resend_blocks.pop();
//             sendBlock(block_number);
//         }
//     }
    
//     //setup a listener for packets to be resent
//     self.on("resendBlock", function(resend_packet){
//         //if it doesn't belong to us, just ignore it
//         if (resend_packet.request_id != packet.request_id) return;
        
//         resend_blocks.push(resend_packet.resend_block);
//     });
    
//     //event that only the client should send on a transfer abort or
//     //file has been sent successfully
//     self.on("endLongTransfer", function(end_packet){
//         fs.close(fd);
//         quit_xfer = true;
//     });
    
//     var ack_packet = {
//         context: packet.from,
//         type: "startLongTransfer",
//         request_id: packet.request_id,
//         block_size: block_size,
//         total_blocks: total_blocks,
//         header: {
//             "Content-Type": "" //@todo
//         }
//     };
//     self.send(ack_packet);
    
//     for (var current_block=0; current_block<total_blocks; current_block++) {
//         sendBlock(current_block);
        
//         //every 8 blocks lets do some resends.  
//         //We don't want to go past 8k so our client handler won't have to pause streaming to user.
//         if (current_block%8 === 0) {
//             resendBlocks();
//         }
//     }
    
//     resendBlocks();
// };

// /**
//  * used to receive large files accross the bus.
//  */
// PartyLineSub.prototype.receiveFile = function(file_buffer, init_packet){
//     var self = this;
//     //chunks being processed
//     var chunks = [];
//     //chunks written
//     var last_chunk_written = -1;
//     var request_id = init_packet.request_id;
    
//     /**
//      * Object for managing transfered blocks into chunks.
//      */
//     function ReceiveChunk(chunk_pos){
//         var rchunk = this;
//         // buffer is 8 blocks long
//         var outgoing_buffer = new Buffer(8*init_packet.block_size);
//         var received_blocks = [];
//         this.completed = false;
//         this.chunk_pos = chunk_pos;
        
//         function incomingBlock(packet) {
//             //check to see if some how we ended up in the wrong chunk
//             if (Math.floor(packet.block_position/8) != chunk_pos) return;
//             //calculate the offset in buffer based on block_position
//             var buffer_pos = packet.block_position % 8;
            
//             //check to see if we have already received this block
//             if (received_blocks.indexOf(packet.block_position) != -1) return;
//             //check to see if we missed a packet
//             if (received_blocks[received_blocks.length-1]+1 < packet.block_position) {
//                 var resend_packet = {
//                     context: packet.from,
//                     type: "resendBlock",
//                     resend_block: received_blocks[received_blocks.length-1]+1
//                 };
//                 self.send(resend_packet);
//             }

//             outgoing_buffer[buffer_pos] = (new Buffer(packet.data, "base64")).toString();
//             //mark this block as successful
//             received_blocks.push(packet.block_position);
            
//             //check to see if chunk has been completed.
//             if (received_blocks.length > 7) {
//                 if (last_chunk_written+1 == chunk_pos) {
//                     file_buffer.write(outgoing_buffer);
//                 }
//                 rchunk.completed = true;
//             }
//         }
        
//         self.on("blockLongTransfer", function(packet) {
//             //check to see if packet belongs to us
//             if (packet.request_id != request_id) return;
            
//             var chunk_position = Math.floor(packet.block_position/8);
//             if (chunk_position == rchunk.chunk_pos) {
//                 var buffer_offset = packet.block_position%8;
//                 outgoing_buffer[buffer_offset] = (new Buffer(packet.data, "base64")).toString();
//                 received_blocks.push(packet.block_position);
                
//                 if (received_blocks.length > 7) {
//                     rchunk.completed = true;
//                 }
//             }
//         });
//     }
    
//     //watches incoming blocks and decides whether or not to start a new chunk
//     //to handle the blocks.
//     self.on("blockLongTransfer", function(packet){
//         if (packet.request_id != request_id) return;
        
//         var chunk_position = Math.floor(packet.block_position/8);
//         if (chunks.indexOf(chunk_position)==-1) {
//             new ReceiveChunk(chunk_position);
//             chunks.push(chunk_position);
//         }
//     });
// };

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
    
    //messages coming down from the bus
    if (packet.from == "bus") {
        switch(packet.type) {
            case "youAre":
                self.bus_id = packet.bus_id;
                self.worker_id = packet.worker_id;
                break;
        }
    }
    
    //send this packet to calling application
    self.packet_handlers.forEach(function(packet_handler){
        if (packet.type == packet_handler.packet_type) {
            try {
                packet_handler.cb_packet_handler(packet);
            } catch(err) {
                self.logger.error("Packet Handler:"+err, {broken_packet:packet});
            }
        }
    });
    self.logger.info("From:"+packet.from+"  Context:"+packet.context+"  Type:"+packet.type);
});


/**
 * A general catch for when something goes wrong in the down stream and 
 * sends a message to the upstream.
 */
partylinesub.input_stream.on("error", function(err){
    // Do we really want to send the error as a broadcast on the bus?
    // var error_packet = {
    //     type: 'error',
    //     data: err
    // };
    // partylinesub.send(error_packet);
    partylinesub.logger.error(err);
});
