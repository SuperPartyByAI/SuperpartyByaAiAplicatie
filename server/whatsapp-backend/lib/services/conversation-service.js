/**
 * Conversation Service
 *
 * Handles conversation operations and business logic
 */

/* supabase admin removed */
const Conversation = require('../models/conversation');
const Message = require('../models/message');

class ConversationService {
  constructor(db) {
    this.db = db;
    this.conversationsRef = db.collection('whatsappConversations');
    this.messagesRef = db.collection('whatsappMessages');
  }

  /**
   * Get or create conversation for a client phone
   */
  async getOrCreateConversation(clientPhone) {
    const snapshot = await this.conversationsRef
      .where('client_phone', '==', clientPhone)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      return Conversation.fromDatabase(snapshot.docs[0]);
    }

    // Create new conversation
    const newConv = new Conversation({
      client_phone: clientPhone,
      status: 'AVAILABLE',
      unread_count_for_operator: 0,
    });

    const docRef = await this.conversationsRef.add(newConv.toDatabase());
    newConv.conversation_id = docRef.id;

    return newConv;
  }

  /**
   * Reserve conversation for operator
   */
  async reserveConversation(conversationId, operatorCode) {
    const docRef = this.conversationsRef.doc(conversationId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error('Conversation not found');
    }

    const conversation = Conversation.fromDatabase(doc);

    if (!conversation.canBeReservedBy(operatorCode)) {
      throw new Error('Conversation cannot be reserved');
    }

    conversation.reserve(operatorCode, admin.database.new Date());

    await docRef.update(conversation.toDatabase());

    return conversation;
  }

  /**
   * Release conversation (back to AVAILABLE)
   */
  async releaseConversation(conversationId) {
    const docRef = this.conversationsRef.doc(conversationId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error('Conversation not found');
    }

    const conversation = Conversation.fromDatabase(doc);
    conversation.release(admin.database.new Date());

    await docRef.update(conversation.toDatabase());

    return conversation;
  }

  /**
   * Add client message to conversation
   */
  async addClientMessage(conversationId, content) {
    const timestamp = admin.database.new Date();

    const message = Message.createClientMessage(conversationId, content, timestamp);
    await this.messagesRef.add(message.toDatabase());

    // Update conversation
    await this.conversationsRef.doc(conversationId).update({
      last_client_message_at: timestamp,
      unread_count_for_operator: admin.database.FieldValue.increment(1),
    });

    return message;
  }

  /**
   * Add operator message to conversation
   */
  async addOperatorMessage(conversationId, operatorCode, content) {
    const docRef = this.conversationsRef.doc(conversationId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error('Conversation not found');
    }

    const conversation = Conversation.fromDatabase(doc);

    if (!conversation.canBeWrittenBy(operatorCode)) {
      throw new Error('Operator cannot write to this conversation');
    }

    const timestamp = admin.database.new Date();

    const message = Message.createOperatorMessage(conversationId, operatorCode, content, timestamp);
    await this.messagesRef.add(message.toDatabase());

    // Update conversation - reset 5h timer
    await docRef.update({
      last_human_operator_message_at: timestamp,
    });

    return message;
  }

  /**
   * Add AI message to conversation
   */
  async addAIMessage(conversationId, content, isAutoResponse = false) {
    const timestamp = admin.database.new Date();

    const message = Message.createAIMessage(conversationId, content, timestamp, isAutoResponse);
    await this.messagesRef.add(message.toDatabase());

    // Update conversation
    await this.conversationsRef.doc(conversationId).update({
      last_ai_message_at: timestamp,
    });

    return message;
  }

  /**
   * Get messages for conversation
   */
  async getMessages(conversationId) {
    const snapshot = await this.messagesRef
      .where('conversation_id', '==', conversationId)
      .orderBy('timestamp', 'asc')
      .get();

    return snapshot.docs.map(doc => Message.fromDatabase(doc));
  }

  /**
   * Get conversation by ID
   */
  async getConversation(conversationId) {
    const doc = await this.conversationsRef.doc(conversationId).get();

    if (!doc.exists) {
      throw new Error('Conversation not found');
    }

    return Conversation.fromDatabase(doc);
  }

  /**
   * Get available conversations
   */
  async getAvailableConversations() {
    const snapshot = await this.conversationsRef.where('status', '==', 'AVAILABLE').get();

    return snapshot.docs.map(doc => Conversation.fromDatabase(doc));
  }

  /**
   * Get reserved conversations
   */
  async getReservedConversations() {
    const snapshot = await this.conversationsRef.where('status', '==', 'RESERVED').get();

    return snapshot.docs.map(doc => Conversation.fromDatabase(doc));
  }

  /**
   * Get conversations by operator code
   */
  async getConversationsByOperator(operatorCode) {
    const snapshot = await this.conversationsRef
      .where('assigned_operator_code', '==', operatorCode)
      .where('status', '==', 'RESERVED')
      .get();

    return snapshot.docs.map(doc => Conversation.fromDatabase(doc));
  }
}

module.exports = ConversationService;
