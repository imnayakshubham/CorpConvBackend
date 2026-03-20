const { EventEmitter } = require('events');

const eventBus = new EventEmitter();
eventBus.setMaxListeners(20); // room for future listeners

module.exports = eventBus;
