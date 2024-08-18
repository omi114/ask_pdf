import { Configuration, OpenAIApi } from "openai-edge";
import { Message, OpenAIStream, StreamingTextResponse } from "ai";
import { getContext } from "@/lib/context";
import { db } from "@/lib/db";
import { chats, messages as _messages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
//import { NextResponse } from "next/server";

export const runtime = "edge";

const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(config);

export async function POST(req: Request) {
  try {
    const { messages, chatId } = await req.json();
    const _chats = await db.select().from(chats).where(eq(chats.id, chatId));
    if (_chats.length != 1) {
      //return NextResponse.json({ error: "chat not found" }, { status: 404 });
      return Response.error()
    }
    const fileKey = _chats[0].fileKey;
    const lastMessage = messages[messages.length - 1];
    const context = await getContext(lastMessage.content, fileKey);
    //console.log(context);

/* 
Prompt1:
You are provided with a document and you are a helpful assistant who specializes in answering questions based on the docuement provided to you.
      Think step by step about the information available to answer questions.
      Your final response should be as accurate as possible and relevant to the user's query.
      If you do not know the answer, then apologize and say that you don't know the answer.
      Be friendly and strive to help with the most accurate information form the available context.
      QUESTION: ${context}
      Response:
*/

    const prompt = {
      role: "system",
      content: `
      You will be provided with context from a document delimited by START CONTEXT BLOCK and END CONTEXT BLOCK.
      Your task is to answer the question using only the provided context. Think step by step using the content in the context before answering.
      If the context does not contain the information needed to answer this question then simply write: "Insufficient information."

      QUESTION: ${lastMessage}
      
      START CONTEXT BLOCK

      ${context}
      
      END CONTEXT BLOCK
      
      Response:
      `,
    };

    /*
    Available models:
    gpt-4                   $30.00 / 1M tokens  $60.00 / 1M tokens
    gpt-4-32k               $60.00 / 1M tokens  $120.00 / 1M tokens
    
    gpt-3.5-turbo-0125      $0.50 / 1M tokens   $1.50 / 1M tokens
    gpt-3.5-turbo-instruct  $1.50 / 1M tokens   $2.00 / 1M tokens
    */
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo-0125",
      messages: [
        prompt,
        ...messages.filter((message: Message) => message.role === "user"),
      ],
      stream: true,
    });
    const stream = OpenAIStream(response, {
      onStart: async () => {
        // save user message into db
        await db.insert(_messages).values({
          chatId,
          content: lastMessage.content,
          role: "user",
        });
      },
      onCompletion: async (completion) => {
        // save ai message into db
        await db.insert(_messages).values({
          chatId,
          content: completion,
          role: "system",
        });
      },
    });
    return new StreamingTextResponse(stream);
  } catch (error) {}
}