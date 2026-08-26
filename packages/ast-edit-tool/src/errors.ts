/** Tool-call errors surfaced to the model as errored tool results. */
export class ToolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolError";
	}
}