'use client'

import React from 'react'
import { User, Bot, AlertTriangle, FileText, Code2, Paperclip } from 'lucide-react'
import { ChatMessage } from '@/types'
import { HybridStreamingRenderer } from '@pixell/renderer'
import { ThinkingIndicator } from './ThinkingIndicator'
import { FileAttachmentPreview } from './FileAttachmentPreview'
import { useChatStore } from '@/stores/chat-store'

interface EnhancedMessageBubbleProps {
  message: ChatMessage
  isStreaming?: boolean
  className?: string
}

export function EnhancedMessageBubble({ 
  message, 
  isStreaming = false,
  className = '' 
}: EnhancedMessageBubbleProps) {
  // const settings = useChatStore(state => state.settings) // Unused for now

  const getMessageIcon = () => {
    switch (message.role) {
      case 'user':
        return <User size={20} className="text-white" />
      case 'assistant':
        return <Bot size={20} className="text-white" />
      case 'system':
        return <AlertTriangle size={20} className="text-white" />
      default:
        return null
    }
  }

  const getMessageTypeIcon = () => {
    switch (message.messageType) {
      case 'alert':
        return <AlertTriangle size={16} className="text-red-500" />
      case 'file_context':
        return <FileText size={16} className="text-blue-500" />
      case 'code':
        return <Code2 size={16} className="text-purple-500" />
      default:
        return null
    }
  }

  const isUser = message.role === 'user'
  const isAlert = message.messageType === 'alert'

  return (
    <div className={`group w-full text-gray-800 ${isUser ? 'bg-gray-50' : 'bg-white'} ${className}`}>
      <div className="flex gap-4 max-w-4xl mx-auto p-4">
        {/* Avatar */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center ${
          isUser ? 'bg-green-500' : isAlert ? 'bg-red-500' : 'bg-blue-500'
        }`}>
          {getMessageIcon()}
        </div>

        {/* Message Content */}
        <div className="flex-1 space-y-2">
          {/* Message Header - Only show for system messages or when there are attachments */}
          {(message.messageType && message.messageType !== 'text') || 
           (message.attachments && message.attachments.length > 0) || 
           (message.fileReferences && message.fileReferences.length > 0) ? (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              {getMessageTypeIcon()}
              {message.messageType === 'alert' && <span>System Alert</span>}
              {message.messageType === 'file_context' && <span>File Context</span>}
              {message.messageType === 'code' && <span>Code</span>}
              <span className="text-xs text-gray-400">
                {new Date(message.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ) : null}

          {/* Thinking Indicator */}
          {!isUser && message.thinkingSteps && message.thinkingSteps.length > 0 && (
            <ThinkingIndicator
              messageId={message.id}
              steps={message.thinkingSteps}
              isStreamingActive={isStreaming && message.isThinking}
              className="mb-4"
            />
          )}

          {/* File Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-3">
              <FileAttachmentPreview
                attachments={message.attachments}
                onRemove={() => {}} // Read-only for sent messages
              />
            </div>
          )}

          {/* File Context Display */}
          {message.fileReferences && message.fileReferences.length > 0 && (
            <div className="mb-3 text-xs text-blue-600 flex items-center gap-1 bg-blue-50 px-2 py-1 rounded">
              <Paperclip size={12} />
              {message.fileReferences.length} file(s) referenced
            </div>
          )}

          {/* Message Content with Enhanced Renderer */}
          <div className="prose prose-sm max-w-none">
            <HybridStreamingRenderer
              content={message.content}
              isStreaming={isStreaming}
              className=""
            />
          </div>

          {/* Message Metadata */}
          {message.metadata && (
            <div className="mt-2 text-xs text-gray-500 flex items-center gap-2">
              {message.taskId && (
                <span className="bg-gray-100 px-2 py-1 rounded-full">
                  Task: {message.taskId.slice(0, 8)}
                </span>
              )}
              {message.updatedAt && message.updatedAt !== message.createdAt && (
                <span>
                  Updated: {new Date(message.updatedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 