<?php

namespace App\Http\Requests\Quest\QuestTask;

use App\Http\Requests\BaseFormRequest;
use App\Models\Quest\Quest;

class StoreMultipleRequest extends BaseFormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        // Tasks may only be added to quests the user created.
        $questIds = collect($this->input('tasks', []))->pluck('quest_id')->filter()->unique();

        return $questIds->isEmpty()
            || Quest::whereIn('id', $questIds)->where('creator_id', '!=', $this->user()?->id)->doesntExist();
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'tasks' => 'required|array',
            'tasks.*.quest_id' => 'required|exists:quests,id',
            // bank category moved to quest bank tasks
            'tasks.*.title' => 'required|string|max:255',
            'tasks.*.description' => 'nullable|string',
            'tasks.*.task_type' => 'required|string',
            'tasks.*.serial_number' => 'required|integer',
            'tasks.*.task_data' => 'nullable|array',
            'tasks.*.is_required' => 'nullable|boolean',
            'tasks.*.visibility' => 'nullable|string|in:public,private,unlisted',
            'tasks.*.prerequisite_task_id' => 'nullable|exists:quest_tasks,id',
        ];
    }
}
