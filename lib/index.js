'use strict';
/**
 *  index.js - Shawn Rapp 2014-10-10
 *  Party Line subsystem interface library file.
 *  @author Shawn Rapp
 *  @version 1.0.0
 *  @license MIT. Read LICENSE for more information.
 *  @fileOverview Main library file.
 */

var partylinesub;

/**
 * Module dependencies.
 */

/**
 * Constructor for PartyLineSub
 */
function PartyLineSub(label) {
    var self = this;

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
    
    /**
     * allows developers to attach functions to packets based on packet
     * type.
     * More than one function can be attached to the same 'event'
     */
    self.on = function(packet_type, cb_packet_handler) {
        var new_handler = {
            packet_type: packet_type,
            cb_packet_handler: cb_packet_handler
        };
        self.packet_handlers.push(new_handler);
    };

    self.init = function(label) {
        self.label = label;
        self.worker_id = '';
        self.bus_id = '';
        self.listen_context = [];
        self.packet_handlers = [];
        self.input_stream = require('JSONStream').parse();
        process.stdin.pipe(self.input_stream);
        self.outbound_packets = [];
        self.sending_state = false;
    
        self.logger = require('winston');
        self.logger.add(self.logger.transports.File, {
            filename: self.label ? __dirname + '/../../../pl-sub_' + self.label + '.log' : __dirname + '/../../../pl-sub.log'
        });
        self.logger.remove(self.logger.transports.Console);
    
        self.send({
            context: 'bus',
            type: 'whoAmI'
        });
        
        /**
         * Process incoming JSON data looking for packets.
         */
        self.input_stream.on('data', function(packet) {
            function processPackets() {
                //send this packet to calling application
                self.packet_handlers.forEach(function(packet_handler) {
                    if (packet.type == packet_handler.packet_type) {
                        try {
                            packet_handler.cb_packet_handler(packet);
                            self.logger.info('Module:' + self.label + ' From:' + packet.from + '  Context:' + packet.context + '  Type:' + packet.type);
                        }
                        catch (err) {
                            self.logger.error('Packet Handler:' + err, {
                                broken_packet: packet
                            });
                        }
                    }
                });
            }
        
            //messages coming down from the bus
            if (packet.from === 'bus') {
                switch (packet.type) {
                    case 'youAre':
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
                        self.logger.error('Packet does not match context', packet);
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
        self.input_stream.on('error', function(err) {
            // Do we really want to send the error as a broadcast on the bus?
            // var error_packet = {
            //     type: 'error',
            //     data: err
            // };
            // self.send(error_packet);
            self.logger.error({sub:self.label, error:err});
        });
        
        self.on('uncaughtException', function(err) {
            self.logger.error(err);
        });
        
        self.on('exit', function() {
            var packet = {
                type: 'close',
                exit_level: 0,
            };
            PartyLineSub.send(packet);
            self.logger.info('Subsystem closed.');
        
            process.kill('SIGINT');
        });
    };

    /**
     * Sends to the bus what contexts this subsystem wants to listen to.
     * Accepts no parameters because the context should be set to
     * self.listen_context array.
     */
    self.sendSetListenerContext = function() {
        var setContextPacket = {
            context: 'bus',
            type: 'setListenContext',
            listen_context: self.listen_context
        };
        self.send(setContextPacket);
        self.logger.info('Setting listener to ' + self.listen_context.toString());
    };
    
    /**
     * Adds a context this sub wants to listen on in the stack and sends the stack
     * to the bus.
     */
    self.addListeningContext = function(new_context) {
        self.listen_context.push(new_context);
        self.sendSetListenerContext();
    };
    
    /**
     * Removes the specified listening context from the stack of listening and sends
     * the results to the bus.
     */
    self.removeListeningContext = function(delete_context) {
        var new_context_stack = [];
    
        self.listen_context.forEach(function(context) {
            if (context != delete_context) {
                new_context_stack.push(context);
            }
        });
    
        self.listen_context = new_context_stack;
        self.sendSetListenerContext();
    };
    
    self.matchContext = function(match_context, callback) {
        var matchFound = false;
    
        if (typeof(match_context) == 'undefined') {
            callback(false);
            return;
        }
    
        //this is a direct addressed packet
        if (match_context == self.worker_id) {
            callback(true);
            return;
        }
    
        var reg_pat = new RegExp('^' + match_context + '.*');
        if (typeof self.listen_context == 'string') {
            if (self.listen_context.match(reg_pat)) {
                callback(true);
            }
            else {
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
    
    /** 
     * sends out a request to bus to retrieve a list of services that match the context
     */
    self.queryService = function(query_context, cb_Results) {
        var sap_packet = {
            context: 'bus',
            type: 'sapQuery',
            service_context: query_context,
        };
    
        self.send(sap_packet);
    
        self.on('serviceList', function(packet) {
            cb_Results(packet.serviceList);
        });
    };
    
    /**
     * sends out a query and a request to for a service.
     */
    self.requestService = function(request_packet, cb_Results) {
        request_packet.from = self.worker_id;
        self.queryService(request_packet.context, function(serviceList) {
            var wait_list = serviceList;
            self.logger.info('serviceList', {serviceList:serviceList});
            self.send(request_packet);

            var packetTimeout = setTimeout(function() {
                cb_Results(false);
            }, 1000);

            self.on('noResponse', function(response_packet) {
                self.logger.info("GOT NO RESPONSE");
                var finish_waiting = true;
                for (var i; i < wait_list.length; i++) {
                    if (wait_list[i].worker_id == request_packet.from) {
                        wait_list[i] = 'noResponse';
                    }
                    if (wait_list[i] == 'unknown') {
                        finish_waiting = false;
                    }
                }
    
                if (finish_waiting) {
                    //no one had a answer
                    clearTimeout(packetTimeout);
                    cb_Results(false);
                }
            });
    
            self.on('response', function(response_packet) {
                clearTimeout(packetTimeout);
                wait_list = []; //kill wait list
                cb_Results(response_packet);
            });
        });
    };


    self.init(label);
    console.log(JSON.stringify({type:"message", message:label}));

    self.logger.info('Initialization complete.');
}



module.exports = exports = function(label) {
    return new PartyLineSub(label);
};